import { describe, expect, it } from "vitest";
import {
  FLOOR,
  VoicePool,
  advanceHeart,
  beatsBetween,
  clamp,
  clampPan,
  dbToGain,
  dubGap,
  envelopeSteps,
  envelopeValueAt,
  gainJitter,
  gainToDb,
  generateReverbIR,
  jitter,
  mulberry32,
  softClipCurve,
  timeToDrop,
} from "@/lib/sound/dsp";

describe("small helpers", () => {
  it("clamps pan, treating NaN/undefined as centre", () => {
    expect(clampPan(undefined)).toBe(0);
    expect(clampPan(Number.NaN)).toBe(0);
    expect(clampPan(5)).toBe(1);
    expect(clampPan(-5)).toBe(-1);
    expect(clampPan(0.3)).toBe(0.3);
    expect(clamp(7, 0, 3)).toBe(3);
  });

  it("converts between dB and gain", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(gainToDb(0.1)).toBeCloseTo(-20, 6);
    expect(gainToDb(dbToGain(-13.7))).toBeCloseTo(-13.7, 6);
    expect(Number.isFinite(gainToDb(0))).toBe(true);
  });

  it("is deterministic and in range (mulberry32)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("keeps jitter inside its band", () => {
    expect(jitter(() => 0, 0.025)).toBeCloseTo(0.975, 9);
    expect(jitter(() => 0.5, 0.025)).toBeCloseTo(1, 9);
    expect(jitter(() => 0.999999, 0.025)).toBeLessThanOrEqual(1.025);
    expect(gainJitter(() => 0, 1)).toBeCloseTo(dbToGain(-1), 9);
    expect(gainJitter(() => 0.5, 1)).toBeCloseTo(1, 9);
    const r = mulberry32(9);
    for (let i = 0; i < 200; i++) {
      const j = jitter(r, 0.009);
      expect(j).toBeGreaterThanOrEqual(0.991);
      expect(j).toBeLessThanOrEqual(1.009);
    }
  });
});

describe("envelopes", () => {
  it("starts and ends 80 dB below its own peak, whatever the loudness", () => {
    for (const peak of [0.9, 0.05, 0.002]) {
      const steps = envelopeSteps({ peak, attack: 0.003, dur: 0.2 });
      expect(steps[0]).toEqual({ t: 0, v: peak * FLOOR, ramp: "set" });
      expect(steps[1]).toEqual({ t: 0.003, v: peak, ramp: "linear" });
      const last = steps[steps.length - 1];
      expect(last.ramp).toBe("exp");
      expect(last.v).toBeCloseTo(peak * FLOOR, 12);
      expect(last.t).toBeCloseTo(0.2, 9);
    }
  });

  it("never schedules a non-positive value (exponential ramps throw on ≤ 0)", () => {
    for (const spec of [{ peak: 0.5, attack: 0, dur: 0 }, { peak: 0, attack: 0.5, dur: 0.1 }, { peak: 1e-12, attack: 0.002, hold: 0.1, dur: 1 }]) {
      for (const s of envelopeSteps(spec)) {
        expect(s.v).toBeGreaterThan(0);
        expect(Number.isFinite(s.t)).toBe(true);
      }
    }
  });

  it("clamps the attack to 2 ms (click-free) and keeps time moving forward", () => {
    const steps = envelopeSteps({ peak: 0.4, attack: 0, hold: 0.05, dur: 0.01 });
    expect(steps[1].t).toBe(0.002);
    for (let i = 1; i < steps.length; i++) expect(steps[i].t).toBeGreaterThanOrEqual(steps[i - 1].t);
    expect(steps.some((s) => s.ramp === "set" && s.v === 0.4)).toBe(true); // the hold plateau
    expect(steps[steps.length - 1].t).toBeGreaterThanOrEqual(0.002 + 0.05 + 0.005);
  });

  it("decays exponentially: −40 dB halfway through the decay", () => {
    const spec = { peak: 0.8, attack: 0.01, dur: 0.21 };
    expect(envelopeValueAt(spec, 0.01)).toBeCloseTo(0.8, 9);
    expect(envelopeValueAt(spec, 0.11)).toBeCloseTo(0.8 * 0.01, 9);
    expect(gainToDb(envelopeValueAt(spec, 0.11) / 0.8)).toBeCloseTo(-40, 6);
    expect(timeToDrop(spec, 40)).toBeCloseTo(0.11, 9);
    expect(timeToDrop(spec, 80)).toBeCloseTo(0.21, 9);
    expect(envelopeValueAt(spec, 5)).toBeCloseTo(0.8 * FLOOR, 12);
  });
});

describe("reverb impulse response", () => {
  const sr = 48000;
  const [l, r] = generateReverbIR(sr, 0.8, 7);

  it("has the requested length and is deterministic per seed", () => {
    expect(l.length).toBe(Math.floor(sr * 0.8));
    expect(r.length).toBe(l.length);
    const [l2] = generateReverbIR(sr, 0.8, 7);
    expect(Array.from(l2.slice(0, 2000))).toEqual(Array.from(l.slice(0, 2000)));
    const [l3] = generateReverbIR(sr, 0.8, 8);
    expect(Array.from(l3.slice(0, 2000))).not.toEqual(Array.from(l.slice(0, 2000)));
  });

  it("is stereo-wide, energy-normalised and finite (fades to nothing at the end)", () => {
    expect(Array.from(l.slice(0, 4000))).not.toEqual(Array.from(r.slice(0, 4000)));
    for (const ch of [l, r]) {
      let e = 0;
      for (const v of ch) e += v * v;
      expect(e).toBeCloseTo(0.81, 2);
      for (let i = ch.length - 20; i < ch.length; i++) expect(Math.abs(ch[i])).toBeLessThan(1e-4);
    }
  });

  it("decays: the first 100 ms hold far more energy than the last 100 ms", () => {
    const energy = (a: number, b: number) => {
      let e = 0;
      for (let i = a; i < b; i++) e += l[i] * l[i];
      return e;
    };
    expect(energy(0, 4800)).toBeGreaterThan(20 * energy(l.length - 4800, l.length));
  });
});

describe("soft clipper", () => {
  const size = 4097;
  const curve = softClipCurve(size, 0.62, 0.84);

  it("is transparent below the knee and bounded below the ceiling", () => {
    const x = (i: number) => (i / (size - 1)) * 2 - 1;
    expect(curve[(size - 1) / 2]).toBe(0);
    expect(curve[2662]).toBeCloseTo(x(2662), 6);
    let max = 0;
    for (const v of curve) max = Math.max(max, Math.abs(v));
    expect(max).toBeLessThan(0.84);
    expect(max).toBeGreaterThan(0.82); // a full-scale input lands at ≈ 0.826 (−1.7 dBFS)
  });

  it("is monotonic and odd-symmetric", () => {
    for (let i = 1; i < size; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    for (let i = 0; i < size; i++) expect(curve[i] + curve[size - 1 - i]).toBeCloseTo(0, 6);
  });
});

describe("voice pool", () => {
  it("admits up to its size", () => {
    const pool = new VoicePool<string>(3);
    expect(pool.admit("a", 0)).toEqual({ ok: true });
    expect(pool.admit("b", 1)).toEqual({ ok: true });
    expect(pool.admit("c", 2)).toEqual({ ok: true });
    expect(pool.size).toBe(3);
  });

  it("evicts the lowest-priority, oldest voice for a newcomer that outranks or equals it", () => {
    const pool = new VoicePool<string>(3);
    pool.admit("low-old", 0);
    pool.admit("mid", 1);
    pool.admit("low-new", 0);
    expect(pool.admit("hi", 2)).toEqual({ ok: true, evicted: "low-old" });
    expect(pool.admit("hi2", 2)).toEqual({ ok: true, evicted: "low-new" });
    expect(pool.size).toBe(3);
  });

  it("rejects a newcomer that ranks below everything already playing", () => {
    const pool = new VoicePool<string>(2);
    pool.admit("a", 2);
    pool.admit("b", 1);
    expect(pool.admit("tick", 0)).toEqual({ ok: false });
    expect(pool.size).toBe(2);
  });

  it("among equals the oldest goes first, and release frees a slot", () => {
    const pool = new VoicePool<string>(2);
    pool.admit("first", 1);
    pool.admit("second", 1);
    expect(pool.admit("third", 1)).toEqual({ ok: true, evicted: "first" });
    pool.release("second");
    expect(pool.size).toBe(1);
    expect(pool.admit("fourth", 0)).toEqual({ ok: true });
    pool.release("nope"); // unknown items are ignored
    expect(pool.size).toBe(2);
  });
});

describe("heartbeat timing", () => {
  it("places a soft 'dub' shortly after each 'lub'", () => {
    expect(dubGap(60)).toBeCloseTo(0.13, 9);
    expect(dubGap(130)).toBeCloseTo((60 / 130) * 0.28, 9);
    const beats = beatsBetween(0, 3, 60, 0);
    expect(beats.map((b) => b.kind)).toEqual(["lub", "dub", "lub", "dub", "lub", "dub"]);
    expect(beats.map((b) => +b.t.toFixed(3))).toEqual([0, 0.13, 1, 1.13, 2, 2.13]);
  });

  it("tiles windows without gaps or duplicates (even when a dub straddles the boundary)", () => {
    const all = beatsBetween(0, 6, 72, 0.05);
    const a = beatsBetween(0, 2.123, 72, 0.05);
    const b = beatsBetween(2.123, 4.5, 72, 0.05);
    const c = beatsBetween(4.5, 6, 72, 0.05);
    expect([...a, ...b, ...c].map((x) => +x.t.toFixed(6))).toEqual(all.map((x) => +x.t.toFixed(6)));
    for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThan(all[i - 1].t);
    expect(all[0].t).toBeCloseTo(0.05, 9);
  });

  it("scheduler clock stays in phase when the rate changes", () => {
    const clock = { next: 0 };
    const first = advanceHeart(clock, 1, 60);
    expect(first.map((b) => b.kind)).toEqual(["lub", "dub"]);
    expect(clock.next).toBe(1);
    const second = advanceHeart(clock, 2.5, 120);
    expect(second.filter((b) => b.kind === "lub").map((b) => b.t)).toEqual([1, 1.5, 2]);
    expect(clock.next).toBe(2.5);
    expect(advanceHeart(clock, 2.5, 120)).toEqual([]);
  });

  it("clamps absurd heart rates", () => {
    const fast = beatsBetween(0, 1, 9999, 0).filter((b) => b.kind === "lub");
    expect(fast.length).toBeLessThanOrEqual(4); // 180 bpm cap → 3 beats a second
    const slow = beatsBetween(0, 3, 1, 0).filter((b) => b.kind === "lub");
    expect(slow.length).toBeGreaterThanOrEqual(2); // 40 bpm floor → 1.5 s period
  });
});
