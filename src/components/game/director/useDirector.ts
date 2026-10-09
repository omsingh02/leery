import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { feel } from "@/lib/feel";
import { COLOR } from "@/lib/feel/plan";
import { useFx } from "@/lib/fx";
import { FLIGHT } from "@/lib/motion";
import { sfx } from "@/lib/sound";
import type { CardCode, RevealView, RoomView } from "@/lib/types";
import { clamp } from "@/lib/utils";
import type { RoomController } from "@/hooks/useRoom";
import type { Flight, Point, Spark } from "../FlyLayer";
import { revealSkip, revealTimeline } from "../revealTimeline";
import type { SeatReaction } from "../Seat";
import { detectEvents, incomingCards, justDealt, type GameEvent } from "./events";
import { applyHolds, arrivalHolds, isEmpty, mergeHolds, NO_HOLDS, release, type Holds } from "./holds";

export interface DirectorRefs {
  pile: RefObject<HTMLDivElement | null>;
  handWrap: RefObject<HTMLDivElement | null>;
  seats: MutableRefObject<Map<string, HTMLElement>>;
  /** My avatar in the bar above my hand. */
  myBar: RefObject<HTMLElement | null>;
}

export interface Director {
  /** The room as it should be *presented*: server state, held back where the story hasn't caught up. */
  shown: RoomView;
  flights: Flight[];
  sparks: Spark[];
  endFlight: (id: number) => void;
  endSpark: (id: number) => void;
  /** Bumps whenever cards land on the pile. */
  pileImpact: number;
  reactions: Record<string, SeatReaction>;
  /** Cards that just joined my hand and where they come from. */
  arrivals: { codes: readonly CardCode[]; from: Point } | null;
  /** Bumps when it becomes my turn. */
  waveKey: number;
  /** Cards I'm in the middle of playing (flying; not drawn in the hand any more). */
  hiding: ReadonlySet<CardCode>;
  dealing: boolean;
  /** Play cards: they leave the hand instantly, the request follows. */
  playCards: (cards: CardCode[]) => Promise<boolean>;
  /** Call bluff: the impact is immediate, the request follows. */
  callBluff: () => Promise<boolean>;
  acceptPlay: () => Promise<boolean>;
  onCountStep: (step: number, id: string) => void;
}

const EMPTY: ReadonlySet<CardCode> = new Set();

const dealKey = (code: string, start: number) => `leery.dealt.${code}.${start}`;

/** Is this view the first moments of a game we haven't dealt yet? (Reading only — safe to call twice.) */
function planDeal(v: RoomView): { start: number } | null {
  if (v.status === "lobby") return null;
  const start = justDealt(v);
  if (start === null) return null;
  try {
    if (window.sessionStorage.getItem(dealKey(v.code, start))) return null;
  } catch {
    /* private mode: just play it */
  }
  return { start };
}

function markDealt(code: string, start: number) {
  try {
    window.sessionStorage.setItem(dealKey(code, start), "1");
  } catch {
    /* ignore */
  }
}

/** Everything held back for the deal: empty hands, empty hand-fan, a deck of ten in the middle. */
const dealHold = (v: RoomView): Holds => ({ pile: 10, hand: [], cards: Object.fromEntries(v.players.map((p) => [p.id, 0])) });

const pointOf = (el: Element | null | undefined, topBias = false): Point | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: topBias ? r.top + Math.min(40, r.height / 2) : r.top + r.height / 2 };
};

/** Where on the stereo field a screen point sits (a little narrower than the full width). */
const panOf = (p: Point | null | undefined): number | undefined =>
  p && typeof window !== "undefined" ? clamp((p.x / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1) * 0.85 : undefined;

/**
 * The table's director. It watches the room change, decides what each change *means* ("Mira just
 * threw two cards", "Alex called bluff"), and stages it: cards in flight, impacts on the pile, the
 * reveal's hand-over of the pile, last-card alarms, the opening deal. The server's state is always
 * the truth; the director only decides *when* the picture catches up with it.
 */
export function useDirector({ room, view, refs }: { room: RoomController; view: RoomView; refs: DirectorRefs }): Director {
  const fx = useFx();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  // A brand-new game starts with everything held back (empty hands, a deck in the middle) so the very first paint is the deal.
  const [dealPlan] = useState(() => planDeal(view));
  const [holds, setHolds] = useState<Holds>(() => (dealPlan ? dealHold(view) : NO_HOLDS));
  // "Storing previous props in state": when a new snapshot arrives, put its holds in place *during render*, so the
  // very first paint already tells the story (no one-frame flash of the finished state).
  const [prevView, setPrevView] = useState<RoomView>(view);
  if (prevView.v !== view.v || prevView.status !== view.status) {
    setPrevView(view);
    const arrival = arrivalHolds(prevView, view);
    if (arrival) setHolds((cur) => mergeHolds(cur, arrival));
  }
  const [pileImpact, setPileImpact] = useState(0);
  const [reactions, setReactions] = useState<Record<string, SeatReaction>>({});
  const [arrivals, setArrivals] = useState<Director["arrivals"]>(null);
  const [waveKey, setWaveKey] = useState(0);
  const [hiding, setHiding] = useState<ReadonlySet<CardCode>>(EMPTY);
  const [dealing, setDealing] = useState(dealPlan !== null);

  const ids = useRef(0);
  const timers = useRef<number[]>([]);
  const revealTimers = useRef<number[]>([]);
  const prev = useRef<RoomView | null>(null);
  const logN = useRef(view.log.length ? view.log[view.log.length - 1].n : 0);
  const latest = useRef(view);
  const roomRef = useRef(room);
  const lastOptimisticPlay = useRef(0);
  const lastOptimisticCall = useRef(0);
  const dealingRef = useRef(dealPlan !== null);
  useEffect(() => {
    latest.current = view;
    roomRef.current = room;
  });

  const later = useCallback((ms: number, fn: () => void, bucket = timers) => {
    const id = window.setTimeout(() => {
      bucket.current = bucket.current.filter((x) => x !== id);
      fn();
    }, ms);
    bucket.current.push(id);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      revealTimers.current.forEach(clearTimeout);
    },
    [],
  );

  // ---- small helpers ---------------------------------------------------------------------------------------
  const seatPoint = useCallback(
    (id: string): Point | null => (id === latest.current.me.id ? pointOf(refs.myBar.current) : pointOf(refs.seats.current.get(id))),
    [refs.myBar, refs.seats],
  );
  const launch = useCallback((f: Omit<Flight, "id">) => {
    const id = ++ids.current;
    setFlights((cur) => [...cur, { ...f, id }]);
  }, []);
  const endFlight = useCallback((id: number) => setFlights((cur) => cur.filter((f) => f.id !== id)), []);
  const spark = useCallback((from: Point, to: Point, color: string) => {
    const id = ++ids.current;
    setSparks((cur) => [...cur, { id, from, to, color }]);
  }, []);
  const endSpark = useCallback((id: number) => setSparks((cur) => cur.filter((s) => s.id !== id)), []);
  const react = useCallback((id: string, kind: SeatReaction["kind"]) => {
    setReactions((cur) => ({ ...cur, [id]: { kind, key: (cur[id]?.key ?? 0) + 1 } }));
  }, []);

  // ---- cards across the table ---------------------------------------------------------------------------------
  /** Cards leave `from`, fly to the pile and land with a thud. The pile's count is held until they do. */
  const throwCards = useCallback(
    (by: string, count: number, mine: boolean, pileBefore: number, rects?: Point[]) => {
      const to = pointOf(refs.pile.current);
      const from = rects && rects.length ? rects : mine ? pointOf(refs.handWrap.current, true) : seatPoint(by);
      if (!to || !from) {
        setHolds((h) => release(h, "pile"));
        return;
      }
      const pan = mine ? 0 : panOf(Array.isArray(from) ? from[0] : from);
      setHolds((h) => ({ ...h, pile: pileBefore }));
      later(FLIGHT * 1000 + 1200, () => setHolds((h) => release(h, "pile"))); // failsafe if the landing never reports
      feel.emit({ type: "cards.throw", n: count, mine, pan, dur: FLIGHT });
      if (!mine) react(by, "throw");
      launch({
        from,
        to,
        count,
        unit: mine ? 9 : 6,
        trail: true,
        onLand: (_i, last) => {
          if (!last) return;
          setHolds((h) => release(h, "pile"));
          setPileImpact((n) => n + 1);
          feel.emit({ type: "cards.land", n: count, mine, at: to, pan });
        },
      });
    },
    [later, launch, react, refs.handWrap, refs.pile, seatPoint],
  );

  /** The pile (and the revealed cards) sweep to whoever has to take them. */
  const pickup = useCallback(
    (rv: RevealView, prevHand: readonly CardCode[] | null) => {
      const meId = latest.current.me.id;
      const toMe = rv.picker === meId;
      const target = toMe ? pointOf(refs.handWrap.current, true) : seatPoint(rv.picker);
      const pile = pointOf(refs.pile.current);
      const pan = toMe ? 0 : panOf(target);
      const n = rv.cards.length;
      const rest = Math.max(0, rv.pickup - n);
      const finish = () => {
        feel.emit({ type: "pickup.land", n: rv.pickup, at: target ?? undefined, pan, mine: toMe, bluff: rv.bluff });
        const cur = latest.current;
        const fresh = toMe && prevHand ? incomingCards(prevHand, cur.me.hand) : [];
        setHolds(NO_HOLDS); // counts tick up, the new cards open out in my hand
        if (fresh.length && target) {
          setArrivals({ codes: fresh, from: target });
          later(1400, () => setArrivals(null));
        }
      };
      if (!target) {
        setHolds(NO_HOLDS);
        return;
      }
      feel.emit({ type: "pickup.sweep", n: rv.pickup, dur: 0.62, pan });
      setHolds((h) => ({ ...h, pile: 0 }));
      const revealed = Array.from(document.querySelectorAll("[data-reveal-card]"))
        .map((el) => pointOf(el))
        .filter((p): p is Point => p !== null);
      let pending = (revealed.length ? 1 : 0) + (rest > 0 && pile ? 1 : 0);
      const settle = () => {
        pending -= 1;
        if (pending <= 0) finish();
      };
      if (pending === 0) {
        finish();
        return;
      }
      if (revealed.length) launch({ from: revealed, to: target, count: n, unit: 9, faces: rv.cards, stagger: 0.06, duration: 0.5, trail: true, onDone: settle });
      if (rest > 0 && pile) launch({ from: pile, to: target, count: Math.min(5, rest), unit: 7, delay: 0.12, stagger: 0.05, duration: 0.46, trail: true, onDone: settle });
    },
    [later, launch, refs.handWrap, refs.pile, seatPoint],
  );

  const startReveal = useCallback(
    (before: RoomView | null, next: RoomView) => {
      const rv = next.reveal;
      if (!rv) return;
      revealTimers.current.forEach(clearTimeout);
      revealTimers.current = [];
      const n = rv.cards.length;
      const tl = revealTimeline(n);
      const skip = revealSkip(tl, rv.until - roomRef.current.serverNow());
      const at = (ms: number) => Math.max(0, ms - skip);
      const prevHand = before && rv.picker === next.me.id ? before.me.hand : null;
      later(at(tl.emerge), () => setHolds((h) => (h.pile === undefined ? h : { ...h, pile: Math.max(0, rv.pickup - n) })), revealTimers);
      later(at(tl.pickup), () => pickup(rv, prevHand), revealTimers);
      later(at(tl.land) + 1200, () => setHolds(NO_HOLDS), revealTimers); // failsafe: never leave anything held
    },
    [later, pickup],
  );

  // ---- the opening deal ----------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!dealPlan) return;
    const v = latest.current;
    markDealt(v.code, dealPlan.start);
    const deck = pointOf(refs.pile.current);
    const handPt = pointOf(refs.handWrap.current, true);
    if (!deck || !handPt) {
      setHolds(NO_HOLDS);
      dealingRef.current = false;
      setDealing(false);
      return;
    }
    feel.emit({ type: "deal.shuffle" });
    const local: number[] = [];
    const at = (ms: number, fn: () => void) => void local.push(window.setTimeout(fn, ms));
    const waves = 3;
    const gap = 210;
    const t0 = 160;
    for (let w = 0; w < waves; w++) {
      at(t0 + w * gap, () => {
        const cur = latest.current;
        const targets = cur.players.map((p) => (p.id === cur.me.id ? handPt : (seatPoint(p.id) ?? handPt)));
        feel.emit({ type: "deal.wave", i: w });
        launch({
          from: deck,
          to: targets,
          count: cur.players.length,
          unit: 6,
          duration: 0.34,
          stagger: 0.03,
          onLand: (_i, last) => {
            if (!last) return;
            setHolds((h) => ({
              ...h,
              cards: Object.fromEntries(latest.current.players.filter((p) => p.id !== latest.current.me.id).map((p) => [p.id, Math.round((p.cards * (w + 1)) / waves)])),
            }));
          },
        });
      });
    }
    at(t0 + (waves - 1) * gap + 420, () => {
      const cur = latest.current;
      setHolds(NO_HOLDS);
      setArrivals({ codes: cur.me.hand, from: deck });
      at(1500, () => setArrivals(null));
      dealingRef.current = false;
      setDealing(false);
      if (cur.status === "turn" && cur.turn?.player === cur.me.id) {
        feel.emit({ type: "turn.mine" });
        setWaveKey((k) => k + 1);
      }
    });
    return () => local.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount (StrictMode re-runs it after cleaning up)
  }, []);

  // ---- reacting to what the server tells us -----------------------------------------------------------------
  useEffect(() => {
    const before = prev.current;
    const next = view;
    const r = detectEvents(before, next, logN.current);
    logN.current = r.lastLogN;
    prev.current = next;
    if (!before) return; // first mount: nothing to react to

    const handle = (e: GameEvent) => {
      switch (e.kind) {
        case "play": {
          if (e.mine && Date.now() - lastOptimisticPlay.current < 5000) break; // already staged when I tapped Play
          throwCards(e.by, e.count, e.mine, Math.max(0, next.pile - e.count));
          break;
        }
        case "call": {
          if (e.mine && Date.now() - lastOptimisticCall.current < 5000) break; // the impact already happened under my finger
          const at = seatPoint(e.caller);
          feel.emit({ type: "call", mine: false, at: at ?? undefined, pan: panOf(at) });
          break;
        }
        case "revealStart":
          startReveal(before, next);
          break;
        case "turnStart": {
          if (e.mine) {
            feel.emit({ type: "turn.mine" });
            setWaveKey((k) => k + 1);
          } else {
            feel.emit({ type: "turn.other", pan: panOf(seatPoint(e.player)) });
          }
          const from = e.from && e.from !== e.player ? seatPoint(e.from) : null;
          const to = seatPoint(e.player);
          if (from && to) spark(from, to, COLOR.gold);
          break;
        }
        case "accept": {
          feel.emit(e.mine ? { type: "accept.mine" } : { type: "accept.other", pan: panOf(seatPoint(e.by)) });
          if (!e.mine) react(e.by, "accept");
          break;
        }
        case "lastCard": {
          const at = seatPoint(e.id);
          feel.emit({ type: "lastCard", at: at ?? undefined, pan: panOf(at) });
          break;
        }
        case "timeout":
          if (e.mine) feel.emit({ type: "timer.out" });
          break;
        default:
          break;
      }
    };
    r.events.forEach(handle);
  }, [view, react, seatPoint, spark, startReveal, throwCards]);

  // Leaving the reveal ends every hold, whatever the timers say.
  const lastStatus = useRef(view.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = view.status;
    if (was !== "reveal" || view.status === "reveal") return;
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    setHolds((h) => (dealingRef.current || isEmpty(h) ? h : NO_HOLDS));
  }, [view.status]);

  // Cards I've played stop being "hidden" once the server's hand no longer has them.
  useEffect(() => {
    setHiding((cur) => {
      if (cur.size === 0) return cur;
      const next = new Set([...cur].filter((c) => view.me.hand.includes(c)));
      return next.size === cur.size ? cur : next;
    });
  }, [view.me.hand]);

  // ---- tension: the heartbeat, the closing vignette, the ticking ----------------------------------------------------
  const { status, challenge, turn, me } = view;
  const myTurn = status === "turn" && turn?.player === me.id;
  const deciding = status === "challenge" && !!challenge && (me.canCall || me.canPass) && !me.passed;
  const accused = status === "challenge" && challenge?.by === me.id;
  const tensionDeadline = accused || deciding ? challenge?.deadline : myTurn ? (turn?.deadline ?? null) : null;
  const tensionSince = accused || deciding ? challenge?.since : myTurn ? turn?.since : undefined;
  useEffect(() => {
    if (tensionDeadline == null || tensionSince == null) return;
    const total = Math.max(1000, tensionDeadline - tensionSince);
    const beating = accused || deciding;
    let lastSec = -1;
    let lastVig = -1;
    let lastBpm = -1;
    let lastLevel = -1;
    const setVignette = (level: number, color: string) => {
      if (Math.abs(level - lastVig) < 0.012) return; // nobody can see a smaller change
      lastVig = level;
      fx.vignette(level, color);
    };
    const setHeartbeat = (bpm: number, level: number) => {
      if (Math.abs(bpm - lastBpm) < 1 && Math.abs(level - lastLevel) < 0.02) return;
      lastBpm = bpm;
      lastLevel = level;
      sfx.bed("heartbeat", { on: true, bpm, level });
    };
    const tick = () => {
      const left = tensionDeadline - roomRef.current.serverNow();
      const t = clamp(1 - left / total, 0, 1);
      const k = t ** 1.5;
      const sec = Math.ceil(left / 1000);
      if (beating) {
        setVignette(accused ? 0.14 + 0.62 * k : 0.04 + 0.32 * k, COLOR.bluff);
        setHeartbeat(60 + 54 * k, (accused ? 0.28 : 0.16) + (accused ? 0.32 : 0.26) * k);
        if (sec <= 3 && sec > 0 && sec !== lastSec) feel.emit({ type: "timer.tick", seconds: sec, urgency: clamp(1 - sec / 4, 0, 1) });
      } else if (left < 10_000) {
        // my own turn running out
        const u = clamp(1 - left / 10_000, 0, 1);
        setVignette(0.03 + 0.42 * u * u, u > 0.6 ? COLOR.bluff : COLOR.gold);
        if (sec <= 10 && sec > 0 && sec !== lastSec) feel.emit({ type: "timer.tick", seconds: sec, urgency: u });
      }
      lastSec = sec;
    };
    tick();
    const iv = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(iv);
      fx.vignette(0);
      sfx.bed("heartbeat", { on: false });
    };
  }, [tensionDeadline, tensionSince, accused, deciding, fx]);

  // ---- actions with instant feedback -----------------------------------------------------------------------------------
  const playCards = useCallback(
    async (cards: CardCode[]) => {
      const v = latest.current;
      const wrap = refs.handWrap.current;
      const rects = cards
        .map((c) => pointOf(wrap?.querySelector(`[data-testid="card-${c}"]`)))
        .filter((p): p is Point => p !== null);
      setHiding(new Set(cards));
      lastOptimisticPlay.current = Date.now();
      throwCards(v.me.id, cards.length, true, v.pile, rects);
      const ok = await roomRef.current.play(cards);
      if (!ok) {
        lastOptimisticPlay.current = 0;
        setHiding(EMPTY);
        setHolds((h) => release(h, "pile"));
      }
      return ok;
    },
    [refs.handWrap, throwCards],
  );

  const callBluff = useCallback(async () => {
    const at = pointOf(document.querySelector('[data-testid="call-bluff"]'));
    lastOptimisticCall.current = Date.now();
    feel.emit({ type: "call", mine: true, at: at ?? undefined });
    const ok = await roomRef.current.call();
    if (!ok) lastOptimisticCall.current = 0;
    return ok;
  }, []);

  const acceptPlay = useCallback(async () => {
    feel.emit({ type: "accept.mine" });
    return roomRef.current.pass();
  }, []);

  const onCountStep = useCallback(
    (step: number, id: string) => {
      if (dealingRef.current) return;
      feel.emit({ type: "count.tick", step, pan: panOf(seatPoint(id)) });
    },
    [seatPoint],
  );

  const shown = useMemo(() => applyHolds(view, holds), [view, holds]);

  return { shown, flights, sparks, endFlight, endSpark, pileImpact, reactions, arrivals, waveKey, hiding, dealing, playCards, callBluff, acceptPlay, onCountStep };
}
