import { describe, expect, it } from "vitest";
import { FAST_MS, FrameGovernor, QUALITY, SLOW_MS } from "@/lib/fx/governor";

const feed = (g: FrameGovernor, gap: number, n: number) => {
  let changes = 0;
  for (let i = 0; i < n; i++) if (g.observe(gap)) changes++;
  return changes;
};

describe("frame governor", () => {
  it("stays at full quality on a healthy 60 fps device", () => {
    const g = new FrameGovernor();
    expect(feed(g, 16.7, 600)).toBe(0);
    expect(g.quality.level).toBe(0);
    expect(g.quality).toBe(QUALITY[0]);
  });

  it("steps down after a sustained slow stretch, one level at a time, with a cooldown", () => {
    const g = new FrameGovernor();
    let seen = -1;
    let frames = 0;
    while (g.quality.level === 0 && frames < 200) {
      g.observe(33);
      frames++;
    }
    expect(g.quality.level).toBe(1);
    seen = frames;
    expect(seen).toBeGreaterThan(10); // not on the first hiccup
    // the very next frames can't change it again (cooldown)
    expect(feed(g, 33, 10)).toBe(0);
    feed(g, 33, 100);
    expect(g.quality.level).toBe(2);
    feed(g, 33, 300);
    expect(g.quality.level).toBe(2); // never below the floor
    expect(g.quality.everyN).toBe(2);
    expect(g.quality.countScale).toBeLessThan(QUALITY[1].countScale);
  });

  it("ignores a single long frame (tab switch, GC pause)", () => {
    const g = new FrameGovernor();
    feed(g, 16.7, 50);
    g.observe(5000);
    feed(g, 16.7, 50);
    expect(g.quality.level).toBe(0);
  });

  it("recovers only after a couple of comfortable seconds", () => {
    const g = new FrameGovernor();
    feed(g, 40, 80);
    expect(g.quality.level).toBeGreaterThan(0);
    const down = g.quality.level;
    feed(g, 16.7, 60); // one second: not yet
    expect(g.quality.level).toBe(down);
    feed(g, 16.7, 400);
    expect(g.quality.level).toBeLessThan(down);
  });

  it("does not flap in the grey zone between slow and fast", () => {
    const g = new FrameGovernor();
    const mid = (SLOW_MS + FAST_MS) / 2;
    expect(feed(g, mid, 1000)).toBe(0);
    expect(g.quality.level).toBe(0);
  });

  it("quality only ever gets cheaper as the level rises", () => {
    for (let i = 1; i < QUALITY.length; i++) {
      expect(QUALITY[i].dprCap).toBeLessThanOrEqual(QUALITY[i - 1].dprCap);
      expect(QUALITY[i].countScale).toBeLessThanOrEqual(QUALITY[i - 1].countScale);
      expect(QUALITY[i].everyN).toBeGreaterThanOrEqual(QUALITY[i - 1].everyN);
    }
  });
});
