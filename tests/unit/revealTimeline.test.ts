import { describe, expect, it } from "vitest";
import { revealScale, revealTimeline } from "@/components/game/revealTimeline";

/** The server holds the reveal for 4.5 s (see game.resolve_call). */
const SERVER_HOLD = 4500;

describe("revealTimeline", () => {
  it.each([1, 2, 3, 4])("%i card(s): the whole story — pickup included — lands before the server moves on", (n) => {
    const tl = revealTimeline(n);
    expect(tl.land + 250).toBeLessThanOrEqual(SERVER_HOLD);
  });

  it.each([1, 2, 3, 4])("%i card(s): beats arrive in order", (n) => {
    const tl = revealTimeline(n);
    expect(tl.claim).toBeLessThan(tl.emerge);
    expect(tl.emerge).toBeLessThan(tl.flips[0]);
    expect([...tl.flips].sort((a, b) => a - b)).toEqual(tl.flips);
    expect(tl.flips).toHaveLength(n);
    expect(tl.flips[n - 1] + tl.flip).toBeLessThan(tl.verdict);
    expect(tl.verdict).toBeLessThan(tl.pickup);
    expect(tl.pickup).toBeLessThan(tl.land);
    expect(tl.drum).toBeLessThan(tl.flips[n - 1]);
  });

  it("the last card always waits longer than the others (that's the suspense)", () => {
    for (const n of [2, 3, 4]) {
      const tl = revealTimeline(n);
      const lastGap = tl.flips[n - 1] - tl.flips[n - 2];
      expect(lastGap).toBeGreaterThan(600);
      if (n >= 3) expect(lastGap).toBeGreaterThan(tl.flips[1] - tl.flips[0]);
    }
  });

  it("someone who joins mid-reveal gets the whole story squeezed into the time left, in the same order", () => {
    for (const n of [1, 2, 3, 4]) {
      const tl = revealTimeline(n);
      expect(revealScale(tl, SERVER_HOLD)).toBeGreaterThan(0.98); // a full reveal is told (all but) at full length
      expect(revealScale(tl, tl.land + 300)).toBe(1);
      for (const remaining of [0.8, 0.5, 0.3].map((f) => Math.round(f * (tl.land + 300)))) {
        const k = revealScale(tl, remaining);
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThan(1);
        // every beat is still in order, and the pickup lands before the server moves on
        const beats = [tl.claim, tl.emerge, ...tl.flips, tl.verdict, tl.pickup, tl.land].map((ms) => ms * k);
        expect([...beats].sort((a, b) => a - b)).toEqual(beats);
        expect(tl.land * k).toBeLessThanOrEqual(remaining);
      }
    }
  });

  it("never squeezes to nothing or to nonsense", () => {
    const tl = revealTimeline(3);
    expect(revealScale(tl, 0)).toBe(0.25);
    expect(revealScale(tl, -500)).toBe(0.25);
    expect(revealScale(tl, Number.NaN)).toBe(1);
    expect(revealScale(tl, Number.POSITIVE_INFINITY)).toBe(1);
  });
});
