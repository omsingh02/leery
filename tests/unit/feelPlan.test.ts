import { describe, expect, it } from "vitest";
import { COLOR, plan, type FeelEvent } from "@/lib/feel/plan";

const at = { x: 120, y: 240 };

const EVENTS: FeelEvent[] = [
  { type: "ui.tap" },
  { type: "ui.toggle", on: true },
  { type: "ui.toggle", on: false },
  { type: "ui.error" },
  { type: "ui.copy" },
  { type: "lobby.join" },
  { type: "lobby.leave" },
  { type: "card.select", n: 2 },
  { type: "card.deselect", n: 1 },
  { type: "card.limit" },
  { type: "card.wave", n: 3 },
  { type: "drag.arm" },
  { type: "drag.disarm" },
  { type: "cards.throw", n: 2, mine: true },
  { type: "cards.throw", n: 2, mine: false, pan: -0.4 },
  { type: "cards.land", n: 3, mine: true, at },
  { type: "turn.mine" },
  { type: "turn.other", pan: 0.5 },
  { type: "timer.tick", seconds: 3, urgency: 0.8 },
  { type: "timer.out" },
  { type: "accept.mine" },
  { type: "accept.other", pan: 0.2 },
  { type: "call", mine: true, at },
  { type: "call", mine: false, at, pan: 0.3 },
  { type: "reveal.drumroll", dur: 0.4 },
  { type: "reveal.flip", i: 0, ok: true, at },
  { type: "reveal.flip", i: 1, ok: false, at },
  { type: "reveal.verdict", bluff: true, at },
  { type: "reveal.verdict", bluff: false, at },
  { type: "pickup.sweep", n: 5, dur: 0.6 },
  { type: "pickup.land", n: 5, at, mine: true, bluff: false },
  { type: "count.tick", step: 2 },
  { type: "lastCard", at, pan: -0.2 },
  { type: "deal.shuffle" },
  { type: "deal.wave", i: 1 },
  { type: "game.win", at },
  { type: "game.lose" },
];

describe("feel plan", () => {
  it("every event has at least one channel and well-formed numbers", () => {
    for (const e of EVENTS) {
      const p = plan(e);
      expect(p.cues.length + (p.haptic ? 1 : 0) + p.fx.length, e.type).toBeGreaterThan(0);
      const nums = JSON.stringify(p, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? "BAD" : v));
      expect(nums, e.type).not.toContain('"BAD"');
      for (const [, o] of p.cues) {
        if (o?.pan !== undefined) expect(Math.abs(o.pan)).toBeLessThanOrEqual(1);
        if (o?.level !== undefined) expect(o.level).toBeGreaterThanOrEqual(0);
        if (o?.level !== undefined) expect(o.level).toBeLessThanOrEqual(1);
      }
    }
  });

  it("clamps stereo pan into −1…1", () => {
    const p = plan({ type: "accept.other", pan: 5 });
    expect(p.cues[0][1]?.pan).toBe(1);
    expect(plan({ type: "turn.other", pan: -9 }).cues[0][1]?.pan).toBe(-1);
  });

  it("my own cards buzz the phone; other players' cards don't", () => {
    expect(plan({ type: "cards.throw", n: 2, mine: true }).haptic?.[0]).toBe("play");
    expect(plan({ type: "cards.throw", n: 2, mine: false }).haptic).toBeUndefined();
    expect(plan({ type: "cards.land", n: 2, mine: true }).haptic?.[0]).toBe("land");
    expect(plan({ type: "cards.land", n: 2, mine: false }).haptic).toBeUndefined();
  });

  it("landing weight scales with the number of cards and the impact only shakes for 2+", () => {
    const one = plan({ type: "cards.land", n: 1, mine: true, at });
    const four = plan({ type: "cards.land", n: 4, mine: true, at });
    expect(one.cues[0][1]?.level).toBeLessThan(four.cues[0][1]?.level ?? 0);
    expect(one.fx.some((f) => f.fx === "shake")).toBe(false);
    expect(four.fx.some((f) => f.fx === "shake")).toBe(true);
    // never lands more than 4 cards' worth of weight
    expect(plan({ type: "cards.land", n: 9, mine: true }).cues[0][1]?.n).toBe(4);
  });

  it("a call is the loudest thing: shake, red flash, ring and sparks — less so when someone else makes it", () => {
    const mine = plan({ type: "call", mine: true, at });
    const theirs = plan({ type: "call", mine: false, at });
    const shake = (p: ReturnType<typeof plan>) => p.fx.find((f) => f.fx === "shake");
    expect(shake(mine)).toBeDefined();
    expect((shake(mine) as { intensity: number }).intensity).toBeGreaterThan((shake(theirs) as { intensity: number }).intensity);
    expect(mine.fx.map((f) => f.fx).sort()).toEqual(["burst", "flash", "ring", "shake"]);
    expect(mine.haptic?.[0]).toBe("call");
  });

  it("the verdict is red for a bluff and green for an honest play", () => {
    const bluff = plan({ type: "reveal.verdict", bluff: true, at });
    const honest = plan({ type: "reveal.verdict", bluff: false, at });
    expect(bluff.cues[0][0]).toBe("verdictBluff");
    expect(honest.cues[0][0]).toBe("verdictHonest");
    expect(bluff.fx.find((f) => f.fx === "flash")).toMatchObject({ color: COLOR.bluff });
    expect(honest.fx.find((f) => f.fx === "flash")).toMatchObject({ color: COLOR.trust });
    expect(bluff.fx.some((f) => f.fx === "shake")).toBe(true);
    expect(honest.fx.some((f) => f.fx === "shake")).toBe(false);
  });

  it("each flip says whether the card matched the claim", () => {
    expect(plan({ type: "reveal.flip", i: 2, ok: true }).cues.map(([c]) => c)).toEqual(["flip", "good"]);
    expect(plan({ type: "reveal.flip", i: 2, ok: false }).cues.map(([c]) => c)).toEqual(["flip", "badCard"]);
  });

  it("the win burst needs somewhere to burst from", () => {
    expect(plan({ type: "game.win" }).fx.some((f) => f.fx === "burst")).toBe(false);
    expect(plan({ type: "game.win", at }).fx.filter((f) => f.fx === "burst")).toHaveLength(2);
  });

  it("timer ticks only vibrate once the pressure is on", () => {
    expect(plan({ type: "timer.tick", seconds: 9, urgency: 0.1 }).haptic).toBeUndefined();
    expect(plan({ type: "timer.tick", seconds: 2, urgency: 0.9 }).haptic?.[0]).toBe("tick");
  });
});
