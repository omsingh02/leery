import type { Cue, CueOptions } from "../feel/contract";
import { clamp, clamp01, clampPan } from "./dsp";
import { DESELECT_LADDER, HONEST_TRIAD, LOSE_FIGURE, SELECT_LADDER, WIN_ARPEGGIO, deselectNote, hz, selectNote, semis } from "./notes";
import type { CueFn, CueSpec, ResolvedOpts } from "./types";
import { PLUCK, bell, fmHit, noiseBurst, shimmer, thump, tone } from "./voices";

/** Clamp and default raw options. */
export function resolveOpts(o?: CueOptions): ResolvedOpts {
  const x = o ?? {};
  const finite = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  return {
    pan: clampPan(x.pan),
    n: finite(x.n) ? x.n : undefined,
    level: finite(x.level) ? clamp01(x.level) : undefined,
    dur: finite(x.dur) && x.dur > 0 ? clamp(x.dur, 0.02, 4) : undefined,
    delay: finite(x.delay) && x.delay > 0 ? Math.min(x.delay, 10) : 0,
  };
}

const count = (o: ResolvedOpts, fallback: number, lo: number, hi: number): number => clamp(Math.round(o.n ?? fallback), lo, hi);

/* =============================================================================================
 *  Cue recipes. Gains are linear amplitudes against the master chain (see graph.ts); the offline
 *  check (scripts/audio-check.mjs) keeps loudness consistent across all of them.
 * ========================================================================================== */

/* ----- interface ------------------------------------------------------------------------------ */

const tap: CueFn = (env) => {
  noiseBurst(env, { dur: 0.026, attack: 0.002, gain: 0.16, bp: 2800, q: 1.2 });
  tone(env, { freq: 2100, dur: 0.022, attack: 0.002, gain: 0.05 });
};

const toggle: CueFn = (env, o) => {
  const on = (o.level ?? 1) >= 0.5;
  if (on) {
    tone(env, { freq: 700, to: 1050, glide: 0.05, dur: 0.075, attack: 0.003, gain: 0.07 });
    tone(env, { freq: 1400, to: 2100, glide: 0.05, dur: 0.06, attack: 0.003, gain: 0.02 });
  } else {
    tone(env, { freq: 640, to: 420, glide: 0.05, dur: 0.075, attack: 0.003, gain: 0.065 });
    tone(env, { freq: 1280, to: 840, glide: 0.05, dur: 0.06, attack: 0.003, gain: 0.015 });
  }
};

const error: CueFn = (env) => {
  const knock = (at: number, f0: number, f1: number, gain: number) => {
    tone(env, { at, freq: f0, to: f1, glide: 0.07, dur: 0.1, attack: 0.003, gain, type: "triangle", lp: 700, fixed: true });
    noiseBurst(env, { at, dur: 0.05, attack: 0.002, gain: gain * 0.5, lp: 520 });
  };
  knock(0, 150, 92, 0.2);
  knock(0.085, 128, 78, 0.18);
};

const copy: CueFn = (env) => {
  bell(env, { freq: hz("B5"), dur: 0.1, gain: 0.1, send: 0.1 });
  bell(env, { freq: hz("D6"), at: 0.055, dur: 0.1, gain: 0.1, send: 0.12 });
};

const join: CueFn = (env) => {
  bell(env, { freq: hz("F#5"), dur: 0.14, gain: 0.15, send: 0.2, strike: 0.02 });
  bell(env, { freq: hz("B5"), at: 0.08, dur: 0.18, gain: 0.15, send: 0.25 });
};

const leave: CueFn = (env) => {
  tone(env, { freq: hz("A4"), dur: 0.1, attack: 0.004, gain: 0.13, type: "triangle", lp: 2200, send: 0.1 });
  tone(env, { freq: hz("D4"), at: 0.07, dur: 0.14, attack: 0.004, gain: 0.13, type: "triangle", lp: 1800, send: 0.12 });
};

/* ----- hand ----------------------------------------------------------------------------------- */

const select: CueFn = (env, o) => {
  const f = hz(selectNote(o.n ?? 1));
  bell(env, { freq: f, dur: 0.14, gain: 0.16, partials: PLUCK, strike: 0.03, send: 0.06 });
};

const deselect: CueFn = (env, o) => {
  const f = hz(deselectNote(o.n ?? 0));
  bell(env, { freq: f, dur: 0.11, gain: 0.13, partials: PLUCK.slice(0, 2), send: 0.04 });
};

const limit: CueFn = (env) => {
  const knock = (at: number, a: string, b: string, gain: number) => {
    tone(env, { at, freq: hz(a), dur: 0.08, attack: 0.003, gain, lp: 650, fixed: true });
    tone(env, { at, freq: hz(b), dur: 0.08, attack: 0.003, gain, lp: 650, fixed: true });
    noiseBurst(env, { at, dur: 0.04, attack: 0.002, gain: gain * 0.55, lp: 420 });
  };
  knock(0, "D3", "Eb3", 0.085);
  knock(0.085, "C3", "Db3", 0.075);
};

const wave: CueFn = (env, o) => {
  const k = count(o, 3, 1, 4);
  for (let i = 0; i < k; i++) {
    bell(env, { freq: hz(SELECT_LADDER[i]), at: i * 0.04, dur: 0.12, gain: 0.13, partials: PLUCK, strike: i === 0 ? 0.025 : 0, send: 0.06 });
  }
};

/* ----- cards in motion ------------------------------------------------------------------------ */

const whoosh: CueFn = (env, o) => {
  const dur = o.dur ?? 0.38;
  const layers = count(o, 1, 1, 4);
  const len = dur * (1 + 0.06 * (layers - 1));
  for (let j = 0; j < layers; j++) {
    noiseBurst(env, { at: j * 0.018, dur: len, attack: len * 0.42, gain: 0.26 / Math.sqrt(layers), bp: 400 * (1 + j * 0.05), bpTo: 2200, q: 2.1, lp: 6000 });
  }
  noiseBurst(env, { dur: len, attack: len * 0.5, gain: 0.015, hp: 2400, lp: 6500 });
};

const land: CueFn = (env, o) => {
  const n = count(o, 1, 1, 4);
  const w = clamp01(0.45 + 0.1 * (n - 1) + 0.3 * (o.level ?? 0.5));
  noiseBurst(env, { dur: 0.07, attack: 0.002, gain: 0.3 * w, hp: 1400, lp: 7000, send: 0.12 });
  noiseBurst(env, { dur: 0.06, attack: 0.002, gain: 0.2 * w, bp: 650, q: 0.9 });
  thump(env, { f0: 150, f1: 52, glide: 0.1, dur: 0.2, gain: 0.4 * w, drive: 2.4, lp: 800, send: 0.15 });
};

/* ----- turns and timers ----------------------------------------------------------------------- */

const turn: CueFn = (env) => {
  bell(env, { freq: hz("D5"), dur: 0.26, gain: 0.17, send: 0.3, strike: 0.02 });
  bell(env, { freq: hz("A5"), at: 0.11, dur: 0.3, gain: 0.17, send: 0.35 });
};

const turnOther: CueFn = (env) => {
  bell(env, { freq: hz("A5"), dur: 0.08, gain: 0.05, partials: PLUCK.slice(0, 2) });
};

const tick: CueFn = (env, o) => {
  const u = clamp01(o.level ?? 0);
  const f = 1300 + 600 * u;
  const g = 0.09 * (0.6 + 0.6 * u);
  tone(env, { freq: f, dur: 0.028, attack: 0.002, gain: g });
  noiseBurst(env, { dur: 0.014, attack: 0.002, gain: g * 0.6, bp: f, q: 6 });
};

const buzzer: CueFn = (env) => {
  const saw = (f: number, to: number, gain: number) =>
    tone(env, { freq: f, to, glide: 0.2, dur: 0.26, attack: 0.012, hold: 0.1, gain, type: "sawtooth", lp: 900, lpTo: 500, fixed: true, send: 0.05 });
  saw(118, 94, 0.07);
  saw(121, 97, 0.055);
  noiseBurst(env, { dur: 0.22, attack: 0.01, gain: 0.03, bp: 320, q: 0.8 });
};

/* ----- challenge ------------------------------------------------------------------------------ */

const accept: CueFn = (env) => {
  bell(env, { freq: hz("A5"), dur: 0.19, gain: 0.13, send: 0.2, strike: 0.015 });
};

const acceptOther: CueFn = (env) => {
  bell(env, { freq: hz("A5"), dur: 0.17, gain: 0.05, send: 0.1 });
};

const call: CueFn = (env, o) => {
  const k = 0.6 + 0.4 * (o.level ?? 1);
  thump(env, { f0: 92, f1: 46, glide: 0.2, dur: 0.55, gain: 0.4 * k, drive: 2.8, lp: 600, send: 0.12 });
  noiseBurst(env, { dur: 0.1, attack: 0.002, gain: 0.3 * k, hp: 900, lp: 6500, send: 0.2 });
  fmHit(env, { carrier: 330, ratio: 1.414, idx0: 5, idx1: 0.7, dur: 0.5, gain: 0.26 * k, lp: 4800, send: 0.3 });
  // rising stinger A3 → D4, an octave doubled for body
  tone(env, { at: 0.02, freq: hz("A3"), to: hz("D4"), glide: 0.28, dur: 0.34, attack: 0.12, gain: 0.16 * k, type: "sawtooth", lp: 700, lpTo: 2600, send: 0.25 });
  tone(env, { at: 0.02, freq: hz("A4"), to: hz("D5"), glide: 0.28, dur: 0.34, attack: 0.12, gain: 0.045 * k, send: 0.25 });
};

/* ----- reveal --------------------------------------------------------------------------------- */

const drumroll: CueFn = (env, o) => {
  const dur = o.dur ?? 0.4;
  const { ctx } = env;
  // filtered-noise swell with a fast tremolo, built by hand because it needs an LFO on the gain
  const t = env.t0;
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(1900, t + dur);
  const trem = ctx.createGain();
  trem.gain.value = 0.62;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 14;
  lfoGain.gain.value = 0.38;
  lfo.connect(lfoGain);
  lfoGain.connect(trem.gain);
  const env2 = ctx.createGain();
  env2.gain.setValueAtTime(0.16 * 0.02, t);
  env2.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.93);
  env2.gain.exponentialRampToValueAtTime(0.16 * 0.0001, t + dur + 0.05);
  src.connect(bp);
  bp.connect(trem);
  trem.connect(env2);
  env2.connect(env.out);
  const nodes: AudioNode[] = [src, bp, trem, lfo, lfoGain, env2];
  const offset = env.rand() * Math.max(0, env.noise.duration - dur - 0.2);
  src.start(t, offset, dur + 0.08);
  lfo.start(t);
  lfo.stop(t + dur + 0.08);
  src.onended = () => nodes.forEach((n) => n.disconnect());
};

const flip: CueFn = (env, o) => {
  const k = semis(0.8 * clamp(Math.round(o.n ?? 0), 0, 6));
  noiseBurst(env, { dur: 0.05, attack: 0.002, gain: 0.13, hp: 2200, bp: 3600 * k, q: 0.8, lp: 7500 });
  tone(env, { freq: 1000 * k, to: 650 * k, glide: 0.04, dur: 0.06, attack: 0.002, gain: 0.05 });
  noiseBurst(env, { at: 0.016, dur: 0.02, attack: 0.002, gain: 0.04, hp: 3800, lp: 7500 });
};

const good: CueFn = (env) => {
  bell(env, { freq: hz("D6"), dur: 0.22, gain: 0.12, send: 0.2, strike: 0.015 });
};

const badCard: CueFn = (env) => {
  tone(env, { freq: hz("Eb3"), dur: 0.22, attack: 0.003, gain: 0.2, type: "triangle", lp: 800, fixed: true });
  tone(env, { freq: hz("A3"), dur: 0.22, attack: 0.003, gain: 0.17, type: "triangle", lp: 800, fixed: true });
  noiseBurst(env, { dur: 0.06, attack: 0.002, gain: 0.1, lp: 520 });
};

const verdictBluff: CueFn = (env) => {
  thump(env, { f0: 88, f1: 45, glide: 0.18, dur: 0.7, gain: 0.34, drive: 2.8, lp: 620, send: 0.1 });
  noiseBurst(env, { dur: 0.1, attack: 0.002, gain: 0.32, hp: 800, lp: 6000, send: 0.2 });
  // glass crack: a handful of tiny bright bursts a few ms apart
  [0, 0.014, 0.031, 0.05, 0.076].forEach((at, i) => {
    noiseBurst(env, { at, dur: 0.025 + env.rand() * 0.02, attack: 0.002, gain: 0.16 - i * 0.02, hp: 3400, lp: 7500, send: 0.15 });
  });
  shimmer(env, { at: 0.01, window: 0.12, count: 6, fmin: 3200, fmax: 6200, gain: 0.03, dur: 0.22, send: 0.2 });
  // minor-second cluster stab
  tone(env, { freq: hz("D4"), dur: 0.65, attack: 0.005, gain: 0.15, type: "sawtooth", lp: 1700, lpTo: 600, send: 0.3 });
  tone(env, { freq: hz("Eb4"), dur: 0.65, attack: 0.005, gain: 0.15, type: "sawtooth", lp: 1700, lpTo: 600, send: 0.3 });
};

const verdictHonest: CueFn = (env) => {
  HONEST_TRIAD.forEach((n, i) => bell(env, { freq: hz(n), at: i * 0.055, dur: 0.45, gain: 0.15, send: 0.35, strike: i === 0 ? 0.02 : 0 }));
  bell(env, { freq: hz("D6"), at: 0.17, dur: 0.5, gain: 0.08, send: 0.4 });
  shimmer(env, { at: 0.12, window: 0.35, count: 6, fmin: 3000, fmax: 5800, gain: 0.025, dur: 0.16, send: 0.3 });
};

const pickup: CueFn = (env, o) => {
  const k = count(o, 4, 1, 6);
  const total = o.dur ?? 0.6;
  for (let i = 0; i < k; i++) {
    const frac = k === 1 ? 0 : i / (k - 1);
    const f = 2800 * 0.5 ** frac;
    noiseBurst(env, { at: frac * total * 0.8, dur: 0.075, attack: 0.004, gain: 0.11 * (0.8 + env.rand() * 0.4), bp: f, q: 1, hp: 600, send: 0.05 });
  }
  noiseBurst(env, { dur: total, attack: total * 0.3, gain: 0.04, bp: 2400, bpTo: 900, q: 0.7 });
};

const cardTick: CueFn = (env, o) => {
  const f = 1300 * semis(clamp(Math.round(o.n ?? 0), 0, 12));
  tone(env, { freq: f, dur: 0.034, attack: 0.002, gain: 0.05 });
  noiseBurst(env, { dur: 0.016, attack: 0.002, gain: 0.025, bp: f * 1.5, q: 2 });
};

const lastCard: CueFn = (env) => {
  const note = (at: number, name: string, dur: number) => {
    tone(env, { at, freq: hz(name), dur, attack: 0.006, gain: 0.14, type: "triangle", lp: 2400, send: 0.25, vibrato: { rate: 6, cents: 14 } });
    tone(env, { at, freq: hz(name) * 2, dur: dur * 0.6, attack: 0.006, gain: 0.04, send: 0.25 });
  };
  note(0, "A4", 0.15);
  note(0.15, "Eb4", 0.2);
};

/* ----- game flow ------------------------------------------------------------------------------ */

const shuffle: CueFn = (env) => {
  const bursts = 11;
  for (let i = 0; i < bursts; i++) {
    const at = 0.02 + 0.38 * (i / (bursts - 1)) ** 0.85;
    noiseBurst(env, { at, dur: 0.035, attack: 0.003, gain: 0.07 + env.rand() * 0.06, bp: 1500 + env.rand() * 1500, q: 0.9, hp: 700 });
  }
  noiseBurst(env, { at: 0.42, dur: 0.08, attack: 0.002, gain: 0.12, hp: 1200, lp: 6000 });
  thump(env, { at: 0.42, f0: 110, f1: 60, dur: 0.14, gain: 0.3, send: 0.1 });
};

const deal: CueFn = (env, o) => {
  const k = semis(clamp(Math.round(o.n ?? 0), 0, 12));
  noiseBurst(env, { dur: 0.042, attack: 0.002, gain: 0.1, hp: 2200, bp: 3000 * k, q: 0.8, lp: 7500 });
  tone(env, { freq: 760 * k, dur: 0.05, attack: 0.002, gain: 0.04 });
};

const win: CueFn = (env) => {
  WIN_ARPEGGIO.forEach((n, i) => bell(env, { freq: hz(n), at: i * 0.11, dur: 0.5, gain: 0.14, send: 0.35, strike: i === 0 ? 0.02 : 0 }));
  for (const n of ["D5", "F#5", "A5", "D6"]) tone(env, { freq: hz(n), at: 0.62, dur: 0.8, attack: 0.08, gain: 0.05, send: 0.4 });
  shimmer(env, { at: 0.5, window: 0.8, count: 12, fmin: 2800, fmax: 6000, gain: 0.03, dur: 0.18, send: 0.3 });
};

const lose: CueFn = (env) => {
  LOSE_FIGURE.forEach((n, i) => tone(env, { freq: hz(n), at: i * 0.3, dur: 0.5, attack: 0.01, gain: 0.2, type: "triangle", lp: 1300, send: 0.25 }));
  tone(env, { freq: hz("D3"), dur: 1.0, attack: 0.25, hold: 0.2, gain: 0.1, type: "sawtooth", lp: 420, fixed: true, send: 0.3 });
  thump(env, { f0: 73.4, f1: 70, glide: 0.9, dur: 1.0, attack: 0.15, gain: 0.16, drive: 2.4, lp: 500, send: 0.1 });
};

/* =============================================================================================
 *  The table of cues
 * ========================================================================================== */

const TAIL = 0.85; // reverb tail allowance for cues that use sends

function spec(
  target: number,
  group: CueSpec["group"],
  priority: CueSpec["priority"],
  fn: CueFn,
  life: number | ((o: ResolvedOpts) => number),
  jitter: number,
  minGap = 0.02,
): CueSpec {
  return { fn, target, group, priority, jitter, minGap, trimDb: 0, life: typeof life === "function" ? life : () => life };
}

/** ± pitch jitter: noisy/percussive cues vary more, tonal ones just enough to stop the machine-gun effect. */
const NOISY = 0.025;
const TONAL = 0.009;

export const CUES: Record<Cue, CueSpec> = {
  tap: spec(0.03, "quiet", 0, tap, 0.12, NOISY, 0.03),
  toggle: spec(0.06, "quiet", 0, toggle, 0.16, TONAL),
  error: spec(0.18, "regular", 2, error, 0.4, NOISY, 0.1),
  copy: spec(0.12, "regular", 0, copy, 0.2 + TAIL * 0.6, TONAL),
  join: spec(0.2, "regular", 1, join, 0.4 + TAIL, TONAL),
  leave: spec(0.16, "regular", 1, leave, 0.4 + TAIL * 0.4, TONAL),

  select: spec(0.09, "regular", 1, select, 0.3 + TAIL * 0.3, TONAL, 0.03),
  deselect: spec(0.07, "regular", 0, deselect, 0.25 + TAIL * 0.4, TONAL, 0.03),
  limit: spec(0.16, "regular", 1, limit, 0.35, NOISY, 0.1),
  wave: spec(0.21, "regular", 1, wave, 0.5 + TAIL * 0.3, TONAL),

  whoosh: spec(0.38, "regular", 1, whoosh, (o) => (o.dur ?? 0.38) * 1.3 + 0.15, NOISY, 0.03),
  land: spec(0.14, "impact", 2, land, 0.5 + TAIL, NOISY, 0.04),

  turn: spec(0.35, "regular", 2, turn, 0.8 + TAIL, TONAL, 0.3),
  turnOther: spec(0.08, "quiet", 0, turnOther, 0.25, TONAL, 0.1),
  tick: spec(0.025, "quiet", 0, tick, 0.12, NOISY, 0.05),
  buzzer: spec(0.25, "regular", 2, buzzer, 0.5 + TAIL * 0.3, NOISY, 0.3),

  accept: spec(0.14, "regular", 1, accept, 0.4 + TAIL * 0.5, TONAL, 0.05),
  acceptOther: spec(0.12, "quiet", 0, acceptOther, 0.35 + TAIL * 0.3, TONAL, 0.05),
  call: spec(0.35, "impact", 2, call, 0.9 + TAIL, NOISY, 0.2),

  drumroll: spec(0.4, "regular", 1, drumroll, (o) => (o.dur ?? 0.4) + 0.2, NOISY, 0.2),
  flip: spec(0.06, "regular", 1, flip, 0.2, NOISY, 0.04),
  good: spec(0.16, "regular", 1, good, 0.4 + TAIL * 0.4, TONAL, 0.05),
  badCard: spec(0.16, "regular", 1, badCard, 0.4, NOISY, 0.05),
  verdictBluff: spec(0.45, "impact", 2, verdictBluff, 0.9 + TAIL, NOISY, 0.3),
  verdictHonest: spec(0.55, "impact", 2, verdictHonest, 1.0 + TAIL, TONAL, 0.3),

  pickup: spec(0.6, "regular", 1, pickup, (o) => (o.dur ?? 0.6) + 0.35, NOISY, 0.2),
  cardTick: spec(0.03, "quiet", 0, cardTick, 0.15, NOISY, 0.02),
  lastCard: spec(0.3, "regular", 2, lastCard, 0.6 + TAIL * 0.5, TONAL, 0.5),

  shuffle: spec(0.5, "regular", 1, shuffle, 0.8 + TAIL * 0.4, NOISY, 0.3),
  deal: spec(0.04, "quiet", 0, deal, 0.15, NOISY, 0.02),
  win: spec(1.4, "regular", 2, win, 2.2 + TAIL, TONAL, 0.5),
  lose: spec(1.0, "regular", 2, lose, 1.8 + TAIL, TONAL, 0.5),
};

/**
 * Loudness calibration, dB per cue: `node scripts/audio-check.mjs --calibrate` measures every cue and prints
 * the trims that bring each loudness group to its target (regular −26, quiet −35, impact −23.5 dBFS RMS).
 */
// <trims> (rewritten by `node scripts/audio-check.mjs --write-trims`)
const TRIMS: Partial<Record<Cue, number>> = {
  toggle: -2,
  error: -3,
  copy: 5.5,
  join: -0.5,
  leave: 3.5,
  select: 5.5,
  deselect: 8.5,
  limit: -2.5,
  wave: -1.5,
  whoosh: 2,
  land: 3.5,
  turn: -4.5,
  turnOther: 1,
  tick: 2.5,
  buzzer: -3.5,
  accept: 7.5,
  acceptOther: 4.5,
  call: -9,
  drumroll: 6,
  flip: 8.5,
  good: 7.5,
  badCard: -2.5,
  verdictBluff: -8.5,
  verdictHonest: -5,
  pickup: 9.5,
  cardTick: 2.5,
  lastCard: 0.5,
  shuffle: -5.5,
  deal: 1,
  win: -9,
  lose: -12.5,
};
// </trims>
for (const [cue, db] of Object.entries(TRIMS) as [Cue, number][]) CUES[cue].trimDb = db;

/** Linear gain of a cue's calibration trim. */
export const trimGain = (cue: Cue): number => 10 ** (CUES[cue].trimDb / 20);

export const CUE_NAMES = Object.keys(CUES) as Cue[];

/** Used by tests: the ladders the select/deselect cues walk. */
export const LADDERS = { select: SELECT_LADDER, deselect: DESELECT_LADDER } as const;
