import { describe, expect, it } from "vitest";
import {
  analyze,
  centroidOf,
  clippedCount,
  dcOf,
  envelopeOf,
  fft,
  highpass,
  mixDown,
  peakOf,
  rmsOf,
  spanAbove,
  spectrogramImage,
  stereoRms,
  stft,
  toDb,
  trimTail,
} from "@/lib/sound/analysis";

const SR = 48000;
const sine = (freq: number, amp: number, seconds: number, decay = 0): Float32Array => {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR) * (decay ? Math.exp(-i / SR / decay) : 1);
  return out;
};

describe("levels", () => {
  const x = sine(1000, 0.5, 0.5);

  it("measures peak, RMS and DC of a sine", () => {
    expect(peakOf(x)).toBeCloseTo(0.5, 3);
    expect(rmsOf(x)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(Math.abs(dcOf(x))).toBeLessThan(1e-4);
    expect(dcOf(new Float32Array([0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 9);
    expect(dcOf(new Float32Array())).toBe(0);
  });

  it("counts samples at full scale", () => {
    expect(clippedCount(new Float32Array([0, 0.5, 0.999, -1, 1.2]))).toBe(3);
    expect(clippedCount(x)).toBe(0);
  });

  it("stereo power does not depend on how a signal is panned", () => {
    const g = Math.SQRT1_2; // centre: equal-power split
    const centre = stereoRms([x.map((v) => v * g), x.map((v) => v * g)], 0, x.length);
    const hard = stereoRms([x, new Float32Array(x.length)], 0, x.length);
    expect(centre).toBeCloseTo(hard, 4);
    expect(hard).toBeCloseTo(rmsOf(x), 6);
  });

  it("finds where a burst starts and stops", () => {
    const n = SR * 0.3;
    const burst = new Float32Array(n);
    burst.set(sine(440, 0.1, 0.1), SR * 0.1);
    const env = envelopeOf([burst, burst], SR);
    const span = spanAbove(env, 0.01);
    expect(span).not.toBeNull();
    const startMs = ((span?.first ?? 0) * env.hop * 1000) / SR;
    const endMs = (((span?.last ?? 0) * env.hop + env.win) * 1000) / SR;
    expect(startMs).toBeGreaterThan(95);
    expect(startMs).toBeLessThan(110);
    expect(endMs).toBeGreaterThan(195);
    expect(endMs).toBeLessThan(210);
    expect(spanAbove(envelopeOf([new Float32Array(1000)], SR), 0.01)).toBeNull();
  });
});

describe("spectrum", () => {
  it("FFT of an impulse is flat and of a cosine has two bins", () => {
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < 8; k++) expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 9);

    const n = 16;
    const cr = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 2 * i) / n));
    const ci = new Float64Array(n);
    fft(cr, ci);
    const mags = Array.from({ length: n }, (_, k) => Math.hypot(cr[k], ci[k]));
    expect(mags[2]).toBeCloseTo(n / 2, 6);
    expect(mags[n - 2]).toBeCloseTo(n / 2, 6);
    expect(mags.filter((m) => m > 1e-6).length).toBe(2);
  });

  it("locates a 1 kHz sine in the STFT and reports its centroid", () => {
    const x = sine(1000, 0.5, 0.4);
    const sg = stft(x, SR);
    const mid = sg.frames[Math.floor(sg.frames.length / 2)];
    let best = 0;
    for (let k = 1; k < mid.length; k++) if (mid[k] > mid[best]) best = k;
    expect(Math.abs(best * sg.binHz - 1000)).toBeLessThanOrEqual(sg.binHz);
    expect(mid[best]).toBeGreaterThan(0.4);
    expect(mid[best]).toBeLessThan(0.6);
    expect(Math.abs(centroidOf(sg, 2, sg.frames.length - 3) - 1000)).toBeLessThan(120);
  });

  it("mixes channels down to their average", () => {
    const m = mixDown([new Float32Array([1, 0, 1]), new Float32Array([0, 0, 1])]);
    expect(Array.from(m)).toEqual([0.5, 0, 1]);
  });

  it("a 200 Hz highpass removes sub-bass but keeps the midrange", () => {
    const low = highpass(sine(50, 0.5, 0.4), SR, 200);
    const mid = highpass(sine(1000, 0.5, 0.4), SR, 200);
    const tail = (a: Float32Array) => rmsOf(a, SR * 0.1, a.length);
    expect(toDb(tail(low) / (0.5 / Math.SQRT2))).toBeLessThan(-20);
    expect(toDb(tail(mid) / (0.5 / Math.SQRT2))).toBeGreaterThan(-0.5);
  });
});

describe("analyze()", () => {
  it("reads a decaying tone the way the audio check needs it", () => {
    const tone = sine(1000, 0.5, 0.6, 0.05);
    const m = analyze([tone, tone], SR);
    expect(m.peakDb).toBeCloseTo(toDb(0.5), 1);
    expect(m.clipped).toBe(0);
    expect(m.dc).toBeLessThan(1e-3);
    expect(m.hfShare).toBeLessThan(0.01);
    expect(Math.abs(m.centroidHz - 1000)).toBeLessThan(200);
    // −40 dB below the peak after 0.05 · ln(100) ≈ 0.23 s
    expect(m.durationMs).toBeGreaterThan(215);
    expect(m.durationMs).toBeLessThan(255);
    expect(m.tailDb).toBeLessThan(-60);
    expect(m.rmsDb).toBeLessThan(m.peakDb);
    expect(m.crestDb).toBeCloseTo(m.peakDb - m.rmsDb, 9);
    expect(m.rmsMidDb).toBeCloseTo(m.rmsDb, 0);
    expect(m.onsetMs).toBeLessThan(10);
  });

  it("flags clipping, DC and a tail that never ends", () => {
    const loud = new Float32Array(SR / 10).fill(1);
    const m = analyze([loud, loud], SR);
    expect(m.clipped).toBe(2 * loud.length);
    expect(m.dc).toBeCloseTo(1, 6);
    expect(m.tailDb).toBeGreaterThan(-1);
  });

  it("copes with silence", () => {
    const m = analyze([new Float32Array(2000), new Float32Array(2000)], SR);
    expect(m.durationMs).toBe(0);
    expect(m.rmsDb).toBe(-Infinity);
    expect(m.peakDb).toBeLessThan(-200);
  });

  it("separates sub-bass from what a phone speaker plays", () => {
    const sub = sine(55, 0.5, 0.4, 0.1);
    const m = analyze([sub, sub], SR);
    expect(m.rmsDb - m.rmsMidDb).toBeGreaterThan(15);
  });
});

describe("images and trimming", () => {
  it("drops the silent tail but keeps a small pad", () => {
    const a = new Float32Array(SR);
    a.set(sine(500, 0.3, 0.2), 0);
    const [t] = trimTail([a, a], SR);
    expect(t.length).toBeGreaterThan(Math.floor(SR * 0.2));
    expect(t.length).toBeLessThanOrEqual(Math.ceil(SR * 0.2) + Math.round(SR * 0.04));
    expect(trimTail([new Float32Array(100)], SR)[0].length).toBeLessThanOrEqual(Math.round(SR * 0.04));
  });

  it("renders a spectrogram image with a waveform strip", () => {
    const x = sine(2000, 0.4, 0.3, 0.1);
    const img = spectrogramImage([x, x], SR);
    expect(img.width).toBeGreaterThanOrEqual(320);
    expect(img.width).toBeLessThanOrEqual(1500);
    expect(img.height).toBe(160 + 36);
    expect(img.data.length).toBe(img.width * img.height * 4);
    expect(img.data[3]).toBe(255);
    expect(img.data[img.data.length - 1]).toBe(255);
  });
});
