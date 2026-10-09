/**
 * Pure DSP helpers: no Web Audio objects, so everything here is unit-testable in Node and shared
 * verbatim between the live engine and the offline renderer.
 */

/** −80 dB: exponential envelopes start and end this far below their own peak (they can't touch 0). */
export const FLOOR = 1e-4;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
/** Stereo pan: NaN/undefined → centre; otherwise −1…1. */
export const clampPan = (v: number | undefined): number => (v === undefined || Number.isNaN(v) ? 0 : clamp(v, -1, 1));

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));

/** Small deterministic PRNG (mulberry32) — offline renders and tests must be repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `1 ± amount`, e.g. jitter(rand, 0.025) → 0.975…1.025. */
export const jitter = (rand: () => number, amount: number): number => 1 + (rand() * 2 - 1) * amount;

/** Gain multiplier for a random ±`db` swing. */
export const gainJitter = (rand: () => number, db: number): number => dbToGain((rand() * 2 - 1) * db);

/* ------------------------------------------------------------------------------------ envelopes */

export interface EnvelopeSpec {
  /** Peak amplitude. */
  peak: number;
  /** Seconds from silence to the peak (≥ 2 ms keeps attacks click-free). */
  attack: number;
  /** Seconds to hold at the peak. */
  hold?: number;
  /** Total length in seconds, attack and hold included; the envelope reaches FLOOR here. */
  dur: number;
}

export interface EnvelopeStep {
  /** Seconds from the start. */
  t: number;
  /** Amplitude at that time. */
  v: number;
  /** How the audio parameter should get there. */
  ramp: "set" | "linear" | "exp";
}

/**
 * The automation of a percussive envelope: floor → (linear attack) → peak → (hold) → (exponential
 * decay) → floor, where the floor is 80 dB below the envelope's own peak — so a quiet voice and a loud
 * one decay with the same shape. Exponential decays are what ears expect from struck and plucked things.
 */
export function envelopeSteps({ peak, attack, hold = 0, dur }: EnvelopeSpec): EnvelopeStep[] {
  const a = Math.max(0.002, attack);
  const total = Math.max(dur, a + hold + 0.005);
  const p = Math.max(peak, 1e-9);
  const floor = p * FLOOR;
  const steps: EnvelopeStep[] = [
    { t: 0, v: floor, ramp: "set" },
    { t: a, v: p, ramp: "linear" },
  ];
  if (hold > 0) steps.push({ t: a + hold, v: p, ramp: "set" });
  steps.push({ t: total, v: floor, ramp: "exp" });
  return steps;
}

/** Analytic value of an envelope at time `t` — used to sanity-check automation in tests. */
export function envelopeValueAt(spec: EnvelopeSpec, t: number): number {
  const a = Math.max(0.002, spec.attack);
  const hold = spec.hold ?? 0;
  const total = Math.max(spec.dur, a + hold + 0.005);
  const p = Math.max(spec.peak, 1e-9);
  const floor = p * FLOOR;
  if (t <= 0) return floor;
  if (t < a) return floor + (p - floor) * (t / a);
  if (t < a + hold) return p;
  if (t >= total) return floor;
  const k = (t - a - hold) / (total - a - hold);
  return p * FLOOR ** k;
}

/** Time for an envelope to fall `db` below its peak (it spans 80 dB between the peak and the end). */
export function timeToDrop(spec: EnvelopeSpec, db: number): number {
  const a = Math.max(0.002, spec.attack);
  const hold = spec.hold ?? 0;
  const total = Math.max(spec.dur, a + hold + 0.005);
  return a + hold + ((total - a - hold) * db) / -gainToDb(FLOOR);
}

/* ----------------------------------------------------------------------------- shared tables */

/**
 * A small, dark room. Stereo impulse response: sparse early reflections, then noise under an exponential
 * decay that gets duller over time; it ends in a short fade so the tail is finite by construction.
 */
export function generateReverbIR(sampleRate: number, seconds = 0.8, seed = 7): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  const decay = seconds / 5.6; // ≈ −49 dB at the end before the fade
  const fadeStart = Math.floor(len * 0.86);
  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry32(seed + ch * 101);
    const data = out[ch];
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const white = rand() * 2 - 1;
      // one-pole lowpass whose cutoff falls from ~5.5 kHz to ~1.2 kHz as the tail dies away
      const k = 0.55 - 0.42 * Math.min(1, t / seconds);
      lp += k * (white - lp);
      let v = lp * Math.exp(-t / decay);
      if (i > fadeStart) v *= 1 - (i - fadeStart) / (len - fadeStart);
      data[i] = v;
    }
    // a few early reflections in the first 45 ms (different per channel → width)
    const taps = [0.011, 0.019, 0.027, 0.036, 0.043];
    taps.forEach((tt, j) => {
      const idx = Math.floor((tt + (ch ? 0.0013 : 0) + j * 0.0004) * sampleRate);
      if (idx < len) data[idx] += (0.55 - j * 0.07) * (j % 2 === ch ? 1 : -1);
    });
    // normalise energy so wet level is predictable
    let e = 0;
    for (let i = 0; i < len; i++) e += data[i] * data[i];
    const norm = 1 / Math.sqrt(Math.max(e, 1e-9));
    for (let i = 0; i < len; i++) data[i] *= norm * 0.9;
  }
  return out;
}

/**
 * Transparent safety clipper: identity below `knee`, then a smooth tanh roll-off that approaches but
 * never reaches `ceiling`. Whatever the cues sum to, the output can't clip.
 */
export function softClipCurve(size = 4096, knee = 0.62, ceiling = 0.84): Float32Array {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/* ------------------------------------------------------------------------------ voice budget */

export type Priority = 0 | 1 | 2;

interface PoolEntry<T> {
  item: T;
  priority: Priority;
  seq: number;
}

/**
 * Limits simultaneous cue "plays". When full, a new cue only gets in if something of lower priority
 * (or, among equals, something older) can be evicted; otherwise it is skipped. Pure bookkeeping —
 * the engine does the actual fading and disconnecting.
 */
export class VoicePool<T> {
  private entries: PoolEntry<T>[] = [];
  private seq = 0;
  constructor(readonly max: number) {}

  get size(): number {
    return this.entries.length;
  }

  /** Try to add `item`. Returns `{ ok: false }` if rejected, otherwise `{ ok: true, evicted }`. */
  admit(item: T, priority: Priority): { ok: boolean; evicted?: T } {
    if (this.entries.length < this.max) {
      this.entries.push({ item, priority, seq: this.seq++ });
      return { ok: true };
    }
    // evict the lowest-priority, oldest entry — but only if it ranks below (or equal to) the newcomer
    let victim = 0;
    for (let i = 1; i < this.entries.length; i++) {
      const a = this.entries[i];
      const b = this.entries[victim];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) victim = i;
    }
    if (this.entries[victim].priority > priority) return { ok: false };
    const [gone] = this.entries.splice(victim, 1);
    this.entries.push({ item, priority, seq: this.seq++ });
    return { ok: true, evicted: gone.item };
  }

  release(item: T): void {
    const i = this.entries.findIndex((e) => e.item === item);
    if (i >= 0) this.entries.splice(i, 1);
  }
}

/* ------------------------------------------------------------------------------------ heartbeat */

export interface Beat {
  /** Seconds on the bed's own clock. */
  t: number;
  kind: "lub" | "dub";
}

/** Gap between "lub" and "dub", in seconds (shrinks a little at high heart rates). */
export const dubGap = (bpm: number): number => Math.min(0.13, (60 / bpm) * 0.28);

/**
 * The beats that fall in [from, to) for a heart that started at `origin` and runs at a constant `bpm`.
 * (The live scheduler calls this each tick with a moving window and the current bpm.)
 */
export function beatsBetween(from: number, to: number, bpm: number, origin = 0): Beat[] {
  const period = 60 / clamp(bpm, 40, 180);
  const gap = dubGap(bpm);
  const beats: Beat[] = [];
  const first = Math.max(0, Math.ceil((from - origin - gap) / period));
  for (let k = first; ; k++) {
    const t = origin + k * period;
    if (t >= to) break;
    if (t >= from) beats.push({ t, kind: "lub" });
    if (t + gap >= from && t + gap < to) beats.push({ t: t + gap, kind: "dub" });
  }
  return beats.sort((a, b) => a.t - b.t);
}

export interface HeartClock {
  /** Time of the next "lub". */
  next: number;
}

/**
 * Incremental scheduler for the live heartbeat: returns every beat that starts before `until` and moves
 * the clock past them. The rate may change between calls (phase stays continuous — no skipped or doubled beats).
 */
export function advanceHeart(clock: HeartClock, until: number, bpm: number): Beat[] {
  const period = 60 / clamp(bpm, 40, 180);
  const gap = dubGap(bpm);
  const out: Beat[] = [];
  while (clock.next < until) {
    out.push({ t: clock.next, kind: "lub" }, { t: clock.next + gap, kind: "dub" });
    clock.next += period;
  }
  return out;
}
