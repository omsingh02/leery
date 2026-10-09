import { describe, expect, it } from "vitest";
import { applyHolds, arrivalHolds, mergeHolds, NO_HOLDS, release } from "@/components/game/director/holds";
import { detectEvents, incomingCards, justDealt, type GameEvent } from "@/components/game/director/events";
import { fixture } from "@/dev/fixtures";
import type { LogEntry, RoomView } from "@/lib/types";

const base = () => fixture("turn-theirs") as RoomView;
const kinds = (es: GameEvent[]) => es.map((e) => e.kind);

describe("detectEvents", () => {
  it("replays nothing on first mount, but still learns the log position", () => {
    const v = base();
    const r = detectEvents(null, v, 0);
    expect(r.events.filter((e) => e.kind === "play" || e.kind === "call")).toEqual([]);
    expect(r.lastLogN).toBe(v.log[v.log.length - 1].n);
  });

  it("reports a play (mine or theirs) exactly once", () => {
    const prev = base();
    const entry: LogEntry = { n: 99, t: 1, k: "play", p: "p-mira", pn: "Mira", c: 3, r: "7" };
    const next: RoomView = { ...prev, v: prev.v + 1, log: [...prev.log, entry] };
    const a = detectEvents(prev, next, prev.log[prev.log.length - 1].n);
    expect(a.events).toContainEqual({ kind: "play", by: "p-mira", count: 3, rank: "7", mine: false, n: 99 });
    // feeding the returned position back in must not repeat it
    expect(detectEvents(next, next, a.lastLogN).events.filter((e) => e.kind === "play")).toEqual([]);

    const mine: LogEntry = { n: 100, t: 2, k: "play", p: prev.me.id, pn: "Alex", c: 1, r: "8" };
    const b = detectEvents(next, { ...next, log: [...next.log, mine] }, a.lastLogN);
    expect(b.events).toContainEqual({ kind: "play", by: prev.me.id, count: 1, rank: "8", mine: true, n: 100 });
  });

  describe("live play", () => {
    const entries = (now: number, plays: number, callAge?: number): LogEntry[] => {
      const out: LogEntry[] = [];
      for (let i = 0; i < plays; i++) out.push({ n: 200 + i, t: now - 500 * (plays - i), k: "play", p: "p-mira", pn: "Mira", c: 1, r: "7" });
      if (callAge !== undefined) out.push({ n: 300, t: now - callAge, k: "call", p: "p-vex", pn: "Vex", a: "p-mira", an: "Mira", b: true, x: 3, r: "7" });
      return out;
    };

    it("tells a burst as its last beats: at most two plays and one call per snapshot", () => {
      const prev = base();
      const next: RoomView = { ...prev, log: [...prev.log, ...entries(prev.now, 6, 100)] };
      const r = detectEvents(prev, next, prev.log[prev.log.length - 1].n, { live: { maxAgeMs: 6000 } });
      expect(r.events.filter((e) => e.kind === "play").map((e) => (e.kind === "play" ? e.n : 0))).toEqual([204, 205]);
      expect(r.events.filter((e) => e.kind === "call")).toHaveLength(1);
      expect(r.lastLogN).toBe(300); // …but the position still moves past everything seen
    });

    it("what happened a while ago is history, not news (a phone coming back from the background)", () => {
      const prev = base();
      const next: RoomView = { ...prev, log: [...prev.log, ...entries(prev.now - 60_000, 3, 59_000)] };
      const r = detectEvents(prev, next, prev.log[prev.log.length - 1].n, { live: { maxAgeMs: 6000 } });
      expect(r.events.filter((e) => e.kind === "play" || e.kind === "call")).toEqual([]);
      expect(r.lastLogN).toBe(300);
      // without live mode the log is told as it is (the pure default)
      const all = detectEvents(prev, next, prev.log[prev.log.length - 1].n);
      expect(all.events.filter((e) => e.kind === "play")).toHaveLength(3);
    });

    it("state-driven beats are unaffected by how old the log is", () => {
      const prev = base();
      const ch = fixture("challenge-call") as RoomView;
      const r = detectEvents(prev, { ...ch, log: [...ch.log, ...entries(ch.now - 90_000, 2)] }, 0, { live: { maxAgeMs: 6000 } });
      expect(r.events.some((e) => e.kind === "challengeStart")).toBe(true);
    });
  });

  it("starts a challenge when the status flips, and tells who is accused", () => {
    const prev = base();
    const ch = fixture("challenge-call") as RoomView;
    const r = detectEvents(prev, ch, 0);
    const e = r.events.find((x) => x.kind === "challengeStart");
    expect(e).toMatchObject({ kind: "challengeStart", by: ch.challenge?.by, count: 2, mine: false });
  });

  it("notices accepts as they happen", () => {
    const a = fixture("challenge-call") as RoomView;
    const b: RoomView = { ...a, challenge: a.challenge && { ...a.challenge, passed: ["p-vex"] } };
    const r = detectEvents(a, b, 999);
    expect(kinds(r.events)).toEqual(["accept"]);
    expect(r.events[0]).toMatchObject({ by: "p-vex", mine: false });
  });

  it("turns: reports who had the turn before, and whether it is mine now", () => {
    const theirs = base();
    const mine = fixture("turn-mine") as RoomView;
    const r = detectEvents(theirs, mine, 999);
    const t = r.events.find((x) => x.kind === "turnStart");
    expect(t).toMatchObject({ kind: "turnStart", player: mine.me.id, mine: true, from: theirs.turn?.player });
  });

  it("a repeated snapshot is quiet", () => {
    const v = fixture("turn-mine") as RoomView;
    expect(detectEvents(v, v, 999).events).toEqual([]);
  });

  it("flags the moment somebody is down to a single card", () => {
    const prev = base();
    const next: RoomView = { ...prev, players: prev.players.map((p) => (p.id === "p-vex" ? { ...p, cards: 1 } : { ...p })) };
    const bumped: RoomView = { ...prev, players: prev.players.map((p) => (p.id === "p-vex" ? { ...p, cards: 2 } : { ...p })) };
    const r = detectEvents(prev, next, 999);
    expect(r.events).toContainEqual({ kind: "lastCard", id: "p-vex" });
    expect(r.events).toContainEqual({ kind: "count", id: "p-vex", from: prev.players.find((p) => p.id === "p-vex")?.cards, to: 1 });
    // 3 → 2 is a count change but not yet "last card"
    expect(kinds(detectEvents(prev, bumped, 999).events)).not.toContain("lastCard");
  });

  it("reports the call, the reveal and the end of the game", () => {
    const prev = fixture("challenge-call") as RoomView;
    const rev = fixture("reveal-bluff") as RoomView;
    const call: LogEntry = { n: 77, t: 1, k: "call", p: rev.me.id, pn: "Alex", a: "p-mira", an: "Mira", b: true, x: 9 };
    const r = detectEvents(prev, { ...rev, log: [...rev.log, call] }, 50);
    expect(r.events).toContainEqual({ kind: "call", caller: rev.me.id, accused: "p-mira", mine: true, n: 77 });
    expect(kinds(r.events)).toContain("revealStart");

    const fin = fixture("finished-win") as RoomView;
    expect(detectEvents(rev, fin, 999).events).toContainEqual({ kind: "finished", winner: fin.winner });
  });
});

describe("justDealt", () => {
  it("is the start entry while nothing has been played", () => {
    const v = base();
    const fresh: RoomView = { ...v, log: [{ n: 1, t: 1, k: "start" }] };
    expect(justDealt(fresh)).toBe(1);
    expect(justDealt(v)).toBeNull(); // the fixture has plays after the start
  });

  it("finds a rematch's start even when the previous game is still in the log", () => {
    const v = base();
    const log: LogEntry[] = [
      { n: 1, t: 1, k: "start" },
      { n: 2, t: 2, k: "play", p: "p-mira", pn: "Mira", c: 1, r: "A" },
      { n: 3, t: 3, k: "call", p: "p-vex", pn: "Vex", a: "p-mira", an: "Mira", b: false, x: 2, r: "A" },
      { n: 4, t: 4, k: "start" }, // the rematch
    ];
    expect(justDealt({ ...v, log })).toBe(4);
    expect(justDealt({ ...v, log: [...log, { n: 5, t: 5, k: "play", p: "p-mira", pn: "Mira", c: 1, r: "A" }] })).toBeNull();
  });
});

describe("incomingCards", () => {
  it("is what's new in the hand", () => {
    expect(incomingCards(["AS", "3H"], ["AS", "3H", "3D", "KC"])).toEqual(["3D", "KC"]);
    expect(incomingCards([], [])).toEqual([]);
  });
});

describe("presentation holds", () => {
  const view = fixture("reveal-bluff") as RoomView;

  it("leaves the view alone when nothing is held", () => {
    expect(applyHolds(view, NO_HOLDS)).toBe(view);
  });

  it("pins the pile, a seat's count and my hand until released", () => {
    const hand = view.me.hand.slice(0, 3);
    const held = applyHolds(view, { pile: 4, cards: { "p-mira": 5 }, hand });
    expect(held.pile).toBe(4);
    expect(held.players.find((p) => p.id === "p-mira")?.cards).toBe(5);
    expect(held.me.hand).toEqual(hand);
    expect(held.players.find((p) => p.id === view.me.id)?.cards).toBe(3);
    // untouched seats are the same objects (cheap for memoised children)
    expect(held.players.find((p) => p.id === "p-vex")).toBe(view.players.find((p) => p.id === "p-vex"));
    // the original is not mutated
    expect(view.pile).not.toBe(4);
  });

  it("merges and releases fields independently", () => {
    const a = mergeHolds({ pile: 3, cards: { a: 1 } }, { cards: { b: 2 } });
    expect(a).toEqual({ pile: 3, cards: { a: 1, b: 2 } });
    expect(release(a, "pile")).toEqual({ cards: { a: 1, b: 2 } });
    expect(release(a, "pile", "cards")).toEqual({});
  });
});

describe("arrivalHolds", () => {
  it("a called bluff holds the pile, the picker's count and (if it's me) my hand — from the first frame", () => {
    const prev = fixture("challenge-call") as RoomView;
    const rev = fixture("reveal-honest") as RoomView; // picker is me
    const h = arrivalHolds(prev, rev);
    expect(h?.pile).toBe(rev.reveal?.pickup);
    expect(h?.hand).toEqual(prev.me.hand);
    const picker = rev.players.find((p) => p.id === rev.reveal?.picker);
    expect(h?.cards?.[rev.reveal?.picker ?? ""]).toBe((picker?.cards ?? 0) - (rev.reveal?.pickup ?? 0));

    const bluff = fixture("reveal-bluff") as RoomView; // picker is Mira
    const h2 = arrivalHolds(prev, bluff);
    expect(h2?.hand).toBeUndefined();
  });

  it("another player's play holds the pile at its old count", () => {
    const prev = fixture("turn-theirs") as RoomView;
    const entry: LogEntry = { n: 99, t: 1, k: "play", p: "p-mira", pn: "Mira", c: 2, r: "7" };
    const next: RoomView = { ...(fixture("challenge-call") as RoomView), pile: prev.pile + 2, log: [...prev.log, entry] };
    expect(arrivalHolds(prev, next)).toEqual({ pile: prev.pile });
  });

  it("my own play is staged at the tap, not on arrival; and quiet transitions need nothing", () => {
    const prev = fixture("turn-mine") as RoomView;
    const mine: LogEntry = { n: 99, t: 1, k: "play", p: prev.me.id, pn: "Alex", c: 1, r: "7" };
    const next: RoomView = { ...(fixture("challenge-accused") as RoomView), log: [...prev.log, mine] };
    expect(arrivalHolds(prev, next)).toBeNull();
    expect(arrivalHolds(prev, prev)).toBeNull();
  });
});
