import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { notifyError } from "./notify";
import { api, ApiError } from "./api";
import { clearLastRoom, setLastRoom, setName } from "./session";
import { REALTIME_ENABLED, supabase } from "./supabase";
import type { CardCode, RoomPreview, RoomView, Speed, StateResponse } from "./types";
import { isPreview } from "./types";

export type Connection = "connecting" | "live" | "polling" | "offline";

export interface Snapshot {
  /** First load in progress (no view/preview/error yet). */
  loading: boolean;
  /** Set when you're a member of the room. */
  view: RoomView | null;
  /** Set when you opened the room but aren't a member (join screen). */
  preview: RoomPreview | null;
  /** Fatal-ish load error (room gone, backend not set up, can't connect on first load). */
  error: ApiError | null;
  connection: Connection;
  /** An action (play/call/…) is in flight. */
  busy: boolean;
}

// Realtime pings make updates instant; polling is the always-on safety net.
const POLL_LIVE = 5000;
const POLL_FALLBACK = 1500;
const POLL_HIDDEN = 6000;

/**
 * Keeps one room in sync with the server. Framework-agnostic: React reads it through `useRoom`.
 *
 * - `leery_get_state` is the heartbeat AND the clock: the server lazily advances bots/timers whenever
 *   anyone polls, so polling is scheduled right at `view.due` (plus jitter) for snappy transitions.
 * - Realtime broadcast "pings" tell the other clients to refetch right after a change; if the
 *   websocket is blocked or unauthorised we silently fall back to faster polling.
 */
export class RoomSync {
  readonly code: string;
  private readonly token: string;

  private snap: Snapshot = { loading: true, view: null, preview: null, error: null, connection: "connecting", busy: false };
  private listeners = new Set<() => void>();

  private offset = 0; // serverNow - Date.now()
  private bestRtt = Infinity;
  private samples = 0;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private rerun = false;
  private failures = 0;
  private alive = false;
  private fatal = false;
  private live = false;
  private channel: RealtimeChannel | null = null;
  private remembered = false;

  constructor(code: string, token: string) {
    this.code = code;
    this.token = token;
  }

  // ---- external store API -------------------------------------------------------------------
  getSnapshot = (): Snapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Server-corrected "now" in epoch ms. */
  serverNow = (): number => Date.now() + this.offset;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- lifecycle ----------------------------------------------------------------------------
  start() {
    if (this.alive) return;
    this.alive = true;
    this.fatal = false;
    this.openChannel();
    document.addEventListener("visibilitychange", this.onWake);
    window.addEventListener("online", this.onWake);
    window.addEventListener("focus", this.onWake);
    void this.refresh();
  }

  stop() {
    this.alive = false;
    clearTimeout(this.timer);
    clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
    document.removeEventListener("visibilitychange", this.onWake);
    window.removeEventListener("online", this.onWake);
    window.removeEventListener("focus", this.onWake);
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.live = false;
  }

  private onWake = () => {
    if (document.visibilityState === "visible") void this.refresh();
  };

  private openChannel() {
    if (!REALTIME_ENABLED) {
      this.updateConnection();
      return;
    }
    try {
      const ch = supabase.channel(`leery:${this.code}`, { config: { broadcast: { self: false, ack: false } } });
      // The channel is public (anyone who knows the code may broadcast), so never let pings drive more than
      // ~2 refreshes per second: leading edge immediately, then at most one trailing refresh per window.
      ch.on("broadcast", { event: "ping" }, () => this.onPing());
      ch.subscribe((status) => {
        this.live = status === "SUBSCRIBED";
        this.updateConnection();
      });
      this.channel = ch;
    } catch {
      this.live = false;
    }
  }

  private lastPingRefresh = 0;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;

  private onPing() {
    if (this.pingTimer) return; // a trailing refresh is already queued
    const wait = Math.max(0, 500 - (Date.now() - this.lastPingRefresh));
    this.pingTimer = setTimeout(() => {
      this.pingTimer = undefined;
      this.lastPingRefresh = Date.now();
      void this.refresh();
    }, wait);
  }

  private ping() {
    if (this.live && this.channel) {
      void this.channel.send({ type: "broadcast", event: "ping", payload: {} }).catch(() => undefined);
    }
  }

  private updateConnection() {
    const connection: Connection =
      this.failures >= 2 ? "offline" : this.snap.loading ? "connecting" : this.live ? "live" : "polling";
    if (connection !== this.snap.connection) this.set({ connection });
  }

  // ---- fetching -----------------------------------------------------------------------------
  /** Single-flight refresh: concurrent callers share one request and trigger at most one re-run. */
  refresh = (): Promise<void> => {
    this.fatal = false; // an explicit refresh (retry button, ping, tab wake) may revive a stopped room
    if (this.inflight) {
      this.rerun = true;
      return this.inflight;
    }
    const run = async () => {
      do {
        this.rerun = false;
        await this.fetchOnce();
      } while (this.rerun && this.alive);
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  };

  private async fetchOnce() {
    const sentAt = Date.now();
    const t0 = performance.now();
    try {
      const res: StateResponse = await api.getState(this.token, this.code);
      if (!this.alive) return;
      // A response that isn't a snapshot (e.g. a poll that raced a teardown) is just a failed poll.
      if (!res || typeof res !== "object") throw new ApiError("unknown");
      const rtt = performance.now() - t0;
      this.failures = 0;
      if (isPreview(res)) {
        this.set({ loading: false, error: null, view: null, preview: res });
        this.updateConnection();
      } else {
        this.syncClock(res.now, sentAt, rtt);
        this.applyView(res);
        this.updateConnection();
      }
    } catch (e) {
      if (!this.alive) return;
      const err = e instanceof ApiError ? e : new ApiError("unknown");
      if (err.code === "room_not_found" || err.code === "setup") {
        this.fatal = true;
        if (err.code === "room_not_found") clearLastRoom();
        this.set({ loading: false, error: err, view: null, preview: null });
        return;
      }
      this.failures += 1;
      if (this.snap.loading && this.failures >= 3) this.set({ loading: false, error: err });
      this.updateConnection();
    } finally {
      this.schedule();
    }
  }

  /** Estimate server-clock offset from a response, preferring low-latency samples. */
  private syncClock(serverNow: number, sentAt: number, rtt: number) {
    const sample = serverNow - (sentAt + rtt / 2);
    this.bestRtt = Math.min(this.bestRtt * 1.02 + 0.5, rtt);
    if (this.samples === 0) this.offset = sample;
    else if (rtt <= this.bestRtt * 1.5 + 30) this.offset = this.offset * 0.5 + sample * 0.5;
    this.samples += 1;
  }

  private applyView(view: RoomView) {
    const cur = this.snap.view;
    if (cur && view.v < cur.v) return; // an older response resolved after a newer one
    this.set({ loading: false, error: null, preview: null, view });
    if (!this.remembered) {
      setLastRoom(view.code);
      this.remembered = true;
    }
    if (view.adv) this.ping();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.alive || this.fatal) return;

    const hidden = document.visibilityState === "hidden";
    let delay = hidden ? POLL_HIDDEN : this.live ? POLL_LIVE : POLL_FALLBACK;

    if (this.failures > 0) {
      delay = Math.min(1500 * 2 ** (this.failures - 1), 8000);
    } else {
      const due = this.snap.view?.due;
      if (due != null) {
        const until = due - this.serverNow();
        // Wake just after the server-side deadline; stagger clients so the first poll does the work
        // and the rest find it already done.
        const wake = until > 0 ? until + 60 + Math.random() * 240 : 350 + Math.random() * 150;
        delay = Math.min(delay, wake);
      }
    }
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  // ---- actions ------------------------------------------------------------------------------
  private async act(fn: () => Promise<RoomView>): Promise<boolean> {
    if (this.snap.busy) return false;
    this.set({ busy: true });
    try {
      const view = await fn();
      this.applyView(view);
      this.ping();
      this.schedule();
      return true;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown");
      if (err.code === "bad_phase" || err.code === "not_your_turn") toast(err.message);
      else notifyError(err.message);
      void this.refresh();
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  join = (name: string) =>
    this.act(async () => {
      const view = await api.joinRoom(this.token, this.code, name);
      setName(name);
      return view;
    });
  play = (cards: CardCode[]) => this.act(() => api.play(this.token, this.code, cards));
  call = () => this.act(() => api.call(this.token, this.code));
  pass = () => this.act(() => api.pass(this.token, this.code));
  resume = () => this.act(() => api.resume(this.token, this.code));
  start_ = () => this.act(() => api.start(this.token, this.code));
  addBot = () => this.act(() => api.addBot(this.token, this.code));
  removePlayer = (playerId: string) => this.act(() => api.removePlayer(this.token, this.code, playerId));
  setSpeed = (speed: Speed) => this.act(() => api.setSpeed(this.token, this.code, speed));
  rematch = () => this.act(() => api.rematch(this.token, this.code));

  leave = async (): Promise<boolean> => {
    try {
      await api.leave(this.token, this.code);
      clearLastRoom();
      this.ping();
      return true;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown");
      // Already gone from the room — treat as success so the UI can navigate home.
      if (err.code === "room_not_found" || err.code === "not_in_room") {
        clearLastRoom();
        return true;
      }
      notifyError(err.message);
      return false;
    }
  };
}
