import { describe, expect, it, vi } from "vitest";
import { createShake, DEFAULT_DURATION_MS, shakeOffsets, smoothNoise } from "@/lib/fx/shake";

/** A manual clock and rAF queue, plus a fake <html> that records the CSS variables. */
function harness(opts: { maxOffset?: number; maxRot?: number } = {}) {
  let t = 0;
  let nextId = 0;
  const queue = new Map<number, (ts: number) => void>();
  const vars: Record<string, string> = {};
  const writes = vi.fn();
  const target = {
    style: {
      setProperty(name: string, value: string) {
        vars[name] = value;
        writes(name, value);
      },
    },
  };
  const caf = vi.fn((id: number) => void queue.delete(id));
  const shake = createShake({
    target,
    now: () => t,
    raf: (cb) => {
      queue.set(++nextId, cb);
      return nextId;
    },
    caf,
    ...opts,
  });
  /** Jump to `ms` and run the callbacks that were waiting. */
  const frame = (ms: number) => {
    t = ms;
    const waiting = [...queue.values()];
    queue.clear();
    waiting.forEach((cb) => cb(t));
  };
  return { shake, vars, writes, caf, frame, pending: () => queue.size, at: (ms: number) => void (t = ms) };
}

const num = (s: string) => parseFloat(s);

describe("shake loop", () => {
  it("costs nothing while idle", () => {
    const h = harness();
    expect(h.pending()).toBe(0);
    expect(h.shake.active).toBe(false);
    expect(h.shake.trauma).toBe(0);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("runs one rAF loop while there is trauma, then resets the variables to zero and stops", () => {
    const h = harness();
    h.shake.add(0.6, 300);
    expect(h.pending()).toBe(1);
    expect(h.shake.active).toBe(true);
    h.shake.add(0.1, 300); // a second call must not start a second loop
    expect(h.pending()).toBe(1);

    h.frame(16);
    expect(h.pending()).toBe(1);
    expect(Object.keys(h.vars).sort()).toEqual(["--fx-sr", "--fx-sx", "--fx-sy"]);
    expect(h.vars["--fx-sx"].endsWith("px")).toBe(true);
    expect(h.vars["--fx-sr"].endsWith("deg")).toBe(true);
    expect(Math.hypot(num(h.vars["--fx-sx"]), num(h.vars["--fx-sy"]))).toBeGreaterThan(0);

    h.frame(299);
    expect(h.pending()).toBe(1);
    h.frame(300);
    expect(h.pending()).toBe(0);
    expect(h.shake.active).toBe(false);
    expect(h.vars).toEqual({ "--fx-sx": "0.00px", "--fx-sy": "0.00px", "--fx-sr": "0.000deg" });
    expect(h.shake.trauma).toBe(0);
  });

  it("decays trauma linearly to zero over the duration", () => {
    const h = harness();
    h.shake.add(0.6, 300);
    h.at(150);
    expect(h.shake.trauma).toBeCloseTo(0.3, 5);
    h.at(225);
    expect(h.shake.trauma).toBeCloseTo(0.15, 5);
    h.at(300);
    expect(h.shake.trauma).toBe(0);
  });

  it("defaults to a 300 ms shake", () => {
    expect(DEFAULT_DURATION_MS).toBe(300);
    const h = harness();
    h.shake.add(0.5);
    h.at(150);
    expect(h.shake.trauma).toBeCloseTo(0.25, 5);
    h.at(300);
    expect(h.shake.trauma).toBe(0);
  });

  it("accumulates calls (clamped to 1)", () => {
    const h = harness();
    h.shake.add(0.7, 300);
    h.shake.add(0.7, 300);
    expect(h.shake.trauma).toBe(1);
    const g = harness();
    g.shake.add(0.5, 400);
    g.at(200); // 0.25 left
    g.shake.add(0.25, 400);
    expect(g.shake.trauma).toBeCloseTo(0.5, 5);
  });

  it("a later, shorter call never cuts an earlier longer shake short", () => {
    const h = harness();
    h.shake.add(0.5, 300); // would end at 300
    h.at(200);
    h.shake.add(0.1, 50); // would end at 250
    expect(h.shake.trauma).toBeCloseTo(0.5 * (100 / 300) + 0.1, 5);
    h.at(299);
    expect(h.shake.trauma).toBeGreaterThan(0);
    h.at(300);
    expect(h.shake.trauma).toBe(0);
  });

  it("a later, longer call extends the shake", () => {
    const h = harness();
    h.shake.add(0.4, 200);
    h.at(100);
    h.shake.add(0.2, 500);
    h.at(599);
    expect(h.shake.trauma).toBeGreaterThan(0);
    h.at(600);
    expect(h.shake.trauma).toBe(0);
  });

  it("can start again after finishing", () => {
    const h = harness();
    h.shake.add(0.5, 100);
    h.frame(100);
    expect(h.shake.active).toBe(false);
    h.at(500);
    h.shake.add(0.5, 100);
    expect(h.pending()).toBe(1);
    h.frame(516);
    expect(Math.hypot(num(h.vars["--fx-sx"]), num(h.vars["--fx-sy"]))).toBeGreaterThan(0);
  });

  it("cancel() stops the loop and zeroes the variables", () => {
    const h = harness();
    h.shake.add(1, 500);
    h.frame(16);
    h.shake.cancel();
    expect(h.caf).toHaveBeenCalled();
    expect(h.pending()).toBe(0);
    expect(h.shake.active).toBe(false);
    expect(h.vars["--fx-sx"]).toBe("0.00px");
    expect(h.shake.trauma).toBe(0);
    h.shake.cancel(); // harmless twice
  });

  it("ignores zero, negative and NaN requests", () => {
    const h = harness();
    h.shake.add(0, 300);
    h.shake.add(-1, 300);
    h.shake.add(Number.NaN, 300);
    h.shake.add(0.5, 0);
    h.shake.add(0.5, -10);
    expect(h.pending()).toBe(0);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("clamps an over-large intensity to 1", () => {
    const h = harness();
    h.shake.add(50, 300);
    expect(h.shake.trauma).toBe(1);
  });
});

describe("shake offsets", () => {
  it("noise stays in [-1, 1], is deterministic, and actually moves", () => {
    let min = 1;
    let max = -1;
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const v = smoothNoise(i * 0.004, 1);
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1.2);
    expect(Math.abs(sum / n)).toBeLessThan(0.1); // no drift
    expect(smoothNoise(1.234, 2)).toBe(smoothNoise(1.234, 2));
    expect(smoothNoise(1.234, 1)).not.toBe(smoothNoise(1.234, 2)); // axes are decorrelated
  });

  it("scales with trauma² and is bounded by maxOffset / maxRot", () => {
    for (let i = 0; i < 300; i++) {
      const trauma = (i % 11) / 10;
      const o = shakeOffsets(i * 0.0137, trauma);
      const amount = trauma * trauma;
      expect(Math.abs(o.x)).toBeLessThanOrEqual(10 * amount + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(10 * amount + 1e-9);
      expect(Math.abs(o.r)).toBeLessThanOrEqual(1.2 * amount + 1e-9);
    }
    expect(shakeOffsets(0.7, 0)).toEqual({ x: 0, y: 0, r: 0 });
    const full = shakeOffsets(0.7, 1);
    const half = shakeOffsets(0.7, 0.5);
    expect(half.x / full.x).toBeCloseTo(0.25, 6); // trauma², not trauma
  });

  it("honours custom limits and curve", () => {
    const base = shakeOffsets(0.7, 0.5);
    const big = shakeOffsets(0.7, 0.5, { maxOffset: 20, maxRot: 2.4 });
    expect(big.x / base.x).toBeCloseTo(2, 6);
    expect(big.r / base.r).toBeCloseTo(2, 6);
    const linear = shakeOffsets(0.7, 0.5, { exponent: 1 });
    expect(linear.x / base.x).toBeCloseTo(2, 6); // 0.5¹ vs 0.5²
  });

  it("clamps out-of-range trauma", () => {
    expect(shakeOffsets(0.3, 7)).toEqual(shakeOffsets(0.3, 1));
    expect(shakeOffsets(0.3, -2)).toEqual({ x: 0, y: 0, r: 0 });
  });

  it("the loop publishes offsets within the configured limits", () => {
    const h = harness({ maxOffset: 4, maxRot: 0.5 });
    h.shake.add(1, 400);
    for (let ms = 16; ms < 400; ms += 16) {
      h.frame(ms);
      expect(Math.abs(num(h.vars["--fx-sx"]))).toBeLessThanOrEqual(4 + 0.01);
      expect(Math.abs(num(h.vars["--fx-sy"]))).toBeLessThanOrEqual(4 + 0.01);
      expect(Math.abs(num(h.vars["--fx-sr"]))).toBeLessThanOrEqual(0.5 + 0.001);
    }
  });
});
