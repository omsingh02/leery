import type { CardCode, LogEntry, PlayerView, Rank, RoomView } from "@/lib/types";

/**
 * What just happened at the table, derived by comparing two snapshots of the room.
 * Pure — no timers, no DOM — so the choreography's trigger logic is unit-tested on its own.
 */
export type GameEvent =
  /** Someone put cards on the pile (face-down). */
  | { kind: "play"; by: string; count: number; rank: Rank | null; mine: boolean; n: number }
  /** Someone called bluff on the last play. */
  | { kind: "call"; caller: string; accused: string; mine: boolean; n: number }
  /** A player's turn began (also fires for the very first turn of a game). */
  | { kind: "turnStart"; player: string; rank: Rank; mine: boolean; from: string | null }
  /** The challenge window opened for a play. */
  | { kind: "challengeStart"; by: string; count: number; rank: Rank; mine: boolean }
  /** A player accepted the pending play. */
  | { kind: "accept"; by: string; mine: boolean }
  /** The reveal began. */
  | { kind: "revealStart" }
  /** A player's hand size changed. */
  | { kind: "count"; id: string; from: number; to: number }
  /** A player is down to their final card. */
  | { kind: "lastCard"; id: string }
  /** A fresh game just started (cards dealt). */
  | { kind: "deal"; n: number }
  /** A human ran out of time and the server played for them. */
  | { kind: "timeout"; by: string; mine: boolean }
  /** The game ended. */
  | { kind: "finished"; winner: string | null };

export interface DetectOptions {
  /**
   * Live play, as opposed to replaying a log: only entries that are recent (their age in server time, measured
   * against the snapshot's own clock) are news, and a burst is told as its last few beats. A phone coming back
   * from the background doesn't get twelve old plays and three old calls thrown at it at once.
   */
  live?: { maxAgeMs: number };
}

/** In live mode, how many of each beat a single snapshot may stage. */
const LIVE_CAP: Partial<Record<GameEvent["kind"], number>> = { play: 2, call: 1, timeout: 1, deal: 1 };

export interface DetectResult {
  events: GameEvent[];
  /** Highest log sequence number seen so far — feed back in next time. */
  lastLogN: number;
}

const playerOf = (v: RoomView, id: string): PlayerView | undefined => v.players.find((p) => p.id === id);

/**
 * `prev` is the last snapshot we rendered (null on first mount); `lastLogN` the newest log entry we
 * already reacted to. Returns events in the order they should be told.
 */
export function detectEvents(prev: RoomView | null, next: RoomView, lastLogN: number, opts: DetectOptions = {}): DetectResult {
  const events: GameEvent[] = [];
  const me = next.me.id;
  let newest = lastLogN;

  // ---- log-driven: plays, calls, deals ------------------------------------------------------------------
  const fresh: LogEntry[] = next.log.filter((e) => e.n > lastLogN);
  for (const e of fresh) {
    newest = Math.max(newest, e.n);
    if (prev === null) continue; // first mount: don't replay history
    if (opts.live && next.now - e.t > opts.live.maxAgeMs) continue; // it happened a while ago: the state tells the rest
    if (e.k === "play" && e.p) {
      events.push({ kind: "play", by: e.p, count: e.c ?? 1, rank: e.r ?? null, mine: e.p === me, n: e.n });
    } else if (e.k === "call" && e.p && e.a) {
      events.push({ kind: "call", caller: e.p, accused: e.a, mine: e.p === me, n: e.n });
    } else if (e.k === "start") {
      events.push({ kind: "deal", n: e.n });
    } else if (e.k === "timeout" && e.p) {
      events.push({ kind: "timeout", by: e.p, mine: e.p === me });
    }
  }

  if (opts.live) {
    // keep only the newest few of each beat (the log events are all at the front of the list so far)
    const seen: Partial<Record<GameEvent["kind"], number>> = {};
    for (let i = events.length - 1; i >= 0; i--) {
      const kind = events[i].kind;
      const cap = LIVE_CAP[kind];
      if (cap === undefined) continue;
      seen[kind] = (seen[kind] ?? 0) + 1;
      if (seen[kind]! > cap) events.splice(i, 1);
    }
  }

  // ---- state-driven ----------------------------------------------------------------------------------------
  if (next.status === "challenge" && next.challenge && (prev?.status !== "challenge" || prev.challenge?.since !== next.challenge.since)) {
    events.push({ kind: "challengeStart", by: next.challenge.by, count: next.challenge.count, rank: next.challenge.rank, mine: next.challenge.by === me });
  }

  if (next.status === "reveal" && prev?.status !== "reveal") events.push({ kind: "revealStart" });

  if (next.status === "turn" && next.turn) {
    const changed = prev?.status !== "turn" || prev.turn?.player !== next.turn.player || prev.turn?.since !== next.turn.since;
    if (changed) {
      const from = prev?.turn?.player ?? prev?.challenge?.by ?? prev?.reveal?.accused ?? null;
      events.push({ kind: "turnStart", player: next.turn.player, rank: next.turn.rank, mine: next.turn.player === me, from });
    }
  }

  if (next.status === "challenge" && next.challenge && prev?.status === "challenge" && prev.challenge) {
    for (const id of next.challenge.passed) {
      if (!prev.challenge.passed.includes(id)) events.push({ kind: "accept", by: id, mine: id === me });
    }
  }

  if (prev) {
    for (const p of next.players) {
      const before = playerOf(prev, p.id);
      if (!before || before.cards === p.cards) continue;
      events.push({ kind: "count", id: p.id, from: before.cards, to: p.cards });
      if (p.cards === 1 && before.cards > 1 && next.status !== "lobby") events.push({ kind: "lastCard", id: p.id });
    }
  }

  if (next.status === "finished" && prev && prev.status !== "finished") events.push({ kind: "finished", winner: next.winner });

  return { events, lastLogN: newest };
}

/** Did a brand-new game just begin? (The newest `start` entry, with nothing played after it yet.) */
export function justDealt(view: RoomView): number | null {
  let start: number | null = null;
  for (const e of view.log) {
    if (e.k === "start") start = e.n;
    else if (e.k === "play" || e.k === "call" || e.k === "timeout") start = null; // that game has moved on; a later start may follow
  }
  return start;
}

/** Cards in `next` that weren't in `prev` (the pile I just picked up). */
export function incomingCards(prev: readonly CardCode[], next: readonly CardCode[]): CardCode[] {
  const had = new Set(prev);
  return next.filter((c) => !had.has(c));
}
