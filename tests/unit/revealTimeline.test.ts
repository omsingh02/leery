import { describe, expect, it } from "vitest";
import { revealSkip, revealTimeline } from "@/components/game/revealTimeline";

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

  it("someone who joins mid-reveal gets a compressed story, never a negative one", () => {
    const tl = revealTimeline(2);
    expect(revealSkip(tl, 4500)).toBe(0);
    expect(revealSkip(tl, 1200)).toBeGreaterThan(0);
    expect(revealSkip(tl, -500)).toBeGreaterThan(0);
    expect(tl.land - revealSkip(tl, 1200)).toBeLessThanOrEqual(1200);
  });
});
