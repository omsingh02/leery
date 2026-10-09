import { envelopeSteps, type EnvelopeSpec } from "./dsp";
import type { CueEnv } from "./types";

/**
 * Sound-making primitives. Each one schedules a few nodes relative to `env.t0`, routes them to the
 * play's dry bus (and optionally its reverb send), and disconnects itself when it ends.
 * Frequencies are in Hz and are multiplied by `env.pitch` unless `fixed` is set.
 */

/** Highest partial we allow (keeps the energy out of the harsh top end). */
const MAX_PARTIAL_HZ = 7500;

function applyEnvelope(param: AudioParam, t: number, spec: EnvelopeSpec): void {
  for (const s of envelopeSteps(spec)) {
    const at = t + s.t;
    if (s.ramp === "set") param.setValueAtTime(s.v, at);
    else if (s.ramp === "linear") param.linearRampToValueAtTime(s.v, at);
    else param.exponentialRampToValueAtTime(s.v, at);
  }
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/** dry → env.out, and (if `send` > 0) a scaled copy → env.send. Returns the extra nodes created. */
function route(env: CueEnv, node: AudioNode, send = 0): AudioNode[] {
  node.connect(env.out);
  if (send > 0) {
    const s = env.ctx.createGain();
    s.gain.value = send;
    node.connect(s);
    s.connect(env.send);
    return [s];
  }
  return [];
}

/* --------------------------------------------------------------------------------------- tone */

export interface ToneParams {
  freq: number;
  /** Exponential glide target in Hz. */
  to?: number;
  /** Seconds the glide takes (default: the whole duration). */
  glide?: number;
  /** Seconds after env.t0. */
  at?: number;
  /** Total seconds until the envelope reaches silence. */
  dur: number;
  attack?: number;
  hold?: number;
  gain: number;
  type?: OscillatorType;
  /** Cents. */
  detune?: number;
  lp?: number;
  lpTo?: number;
  q?: number;
  vibrato?: { rate: number; cents: number };
  /** Reverb send, linear relative to the voice's level. */
  send?: number;
  /** Ignore env.pitch (sub-bass, noise-like tones). */
  fixed?: boolean;
}

export function tone(env: CueEnv, p: ToneParams): void {
  const { ctx } = env;
  const t = env.t0 + (p.at ?? 0);
  const pitch = p.fixed ? 1 : env.pitch;
  const osc = ctx.createOscillator();
  osc.type = p.type ?? "sine";
  osc.frequency.setValueAtTime(p.freq * pitch, t);
  if (p.to !== undefined) osc.frequency.exponentialRampToValueAtTime(p.to * pitch, t + (p.glide ?? p.dur));
  if (p.detune) osc.detune.setValueAtTime(p.detune, t);

  const nodes: AudioNode[] = [osc];
  let tail: AudioNode = osc;
  if (p.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = p.q ?? 0.707;
    f.frequency.setValueAtTime(p.lp, t);
    if (p.lpTo) f.frequency.exponentialRampToValueAtTime(p.lpTo, t + p.dur);
    tail.connect(f);
    tail = f;
    nodes.push(f);
  }
  const g = ctx.createGain();
  applyEnvelope(g.gain, t, { peak: p.gain, attack: p.attack ?? 0.003, hold: p.hold, dur: p.dur });
  tail.connect(g);
  nodes.push(g, ...route(env, g, p.send));

  const end = t + p.dur + 0.03;
  if (p.vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = p.vibrato.rate;
    lg.gain.value = p.vibrato.cents;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t);
    lfo.stop(end);
    nodes.push(lfo, lg);
  }
  osc.start(t);
  osc.stop(end);
  osc.onended = () => disconnectAll(nodes);
}

/* -------------------------------------------------------------------------------------- bells */

export interface PartialSpec {
  ratio: number;
  gain: number;
  /** Fraction of the bell's duration this partial rings for. */
  decay: number;
}

/** Soft pluck: fundamental plus two fast-dying overtones. */
export const PLUCK: readonly PartialSpec[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.3, decay: 0.55 },
  { ratio: 3, gain: 0.1, decay: 0.35 },
];

/** Glassy bell: slightly sharp upper partials give the "tink". */
export const GLASS: readonly PartialSpec[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.32, decay: 0.55 },
  { ratio: 2.99, gain: 0.16, decay: 0.4 },
  { ratio: 4.16, gain: 0.07, decay: 0.26 },
];

export interface BellParams {
  freq: number;
  at?: number;
  /** Ring time of the fundamental, seconds. */
  dur: number;
  gain: number;
  partials?: readonly PartialSpec[];
  attack?: number;
  send?: number;
  lp?: number;
  /** Gain of a tiny noise "strike" at the onset (0 = none). */
  strike?: number;
  vibrato?: { rate: number; cents: number };
}

export function bell(env: CueEnv, p: BellParams): void {
  const partials = p.partials ?? GLASS;
  for (const part of partials) {
    const f = p.freq * part.ratio;
    if (f * env.pitch > MAX_PARTIAL_HZ) continue;
    tone(env, {
      freq: f,
      at: p.at,
      dur: Math.max(0.02, p.dur * part.decay),
      attack: p.attack ?? 0.003,
      gain: p.gain * part.gain,
      send: p.send,
      lp: p.lp,
      vibrato: part.ratio === 1 ? p.vibrato : undefined,
    });
  }
  if (p.strike) noiseBurst(env, { at: p.at, dur: 0.018, attack: 0.002, gain: p.strike, bp: Math.min(5200, p.freq * 3.2 * env.pitch), q: 1.2 });
}

/* ------------------------------------------------------------------------------------- noise */

export interface NoiseParams {
  at?: number;
  dur: number;
  attack?: number;
  hold?: number;
  gain: number;
  hp?: number;
  lp?: number;
  lpTo?: number;
  bp?: number;
  bpTo?: number;
  q?: number;
  send?: number;
  /** Offset into the shared noise buffer, seconds (default: random). */
  offset?: number;
}

export function noiseBurst(env: CueEnv, p: NoiseParams): void {
  const { ctx } = env;
  const t = env.t0 + (p.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true; // white noise loops without a seam, so a burst may outlast the buffer
  const room = Math.max(0, env.noise.duration - p.dur - 0.1);
  const offset = p.offset ?? env.rand() * room;

  const nodes: AudioNode[] = [src];
  let tail: AudioNode = src;
  const chain = (f: BiquadFilterNode) => {
    tail.connect(f);
    tail = f;
    nodes.push(f);
  };
  if (p.hp) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.setValueAtTime(p.hp, t);
    chain(f);
  }
  if (p.bp) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = p.q ?? 1;
    f.frequency.setValueAtTime(p.bp, t);
    if (p.bpTo) f.frequency.exponentialRampToValueAtTime(p.bpTo, t + p.dur);
    chain(f);
  }
  if (p.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(p.lp, t);
    if (p.lpTo) f.frequency.exponentialRampToValueAtTime(p.lpTo, t + p.dur);
    chain(f);
  }
  const g = ctx.createGain();
  applyEnvelope(g.gain, t, { peak: p.gain, attack: p.attack ?? 0.002, hold: p.hold, dur: p.dur });
  tail.connect(g);
  nodes.push(g, ...route(env, g, p.send));
  src.start(t, offset, p.dur + 0.03);
  src.onended = () => disconnectAll(nodes);
}

/* ------------------------------------------------------------------------------------ thump */

const driveCurves = new Map<number, Float32Array>();
function driveCurve(drive: number): Float32Array {
  let c = driveCurves.get(drive);
  if (!c) {
    c = new Float32Array(1024);
    const norm = Math.tanh(drive);
    for (let i = 0; i < c.length; i++) c[i] = Math.tanh(drive * ((i / (c.length - 1)) * 2 - 1)) / norm;
    driveCurves.set(drive, c);
  }
  return c;
}

export interface ThumpParams {
  f0: number;
  f1: number;
  glide?: number;
  at?: number;
  dur: number;
  attack?: number;
  gain: number;
  /** Saturation (1 = barely, 3 = obvious). It adds the harmonics that small speakers can actually play. */
  drive?: number;
  lp?: number;
  send?: number;
}

/** A soft low thump: a sine falling in pitch, gently saturated, then lowpassed. */
export function thump(env: CueEnv, p: ThumpParams): void {
  const { ctx } = env;
  const t = env.t0 + (p.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(p.f0, t);
  osc.frequency.exponentialRampToValueAtTime(p.f1, t + (p.glide ?? p.dur * 0.6));
  const ws = ctx.createWaveShaper();
  ws.curve = driveCurve(p.drive ?? 2) as Float32Array<ArrayBuffer>;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.lp ?? 900;
  const g = ctx.createGain();
  applyEnvelope(g.gain, t, { peak: p.gain, attack: p.attack ?? 0.004, dur: p.dur });
  osc.connect(ws);
  ws.connect(lp);
  lp.connect(g);
  const nodes: AudioNode[] = [osc, ws, lp, g, ...route(env, g, p.send)];
  osc.start(t);
  osc.stop(t + p.dur + 0.03);
  osc.onended = () => disconnectAll(nodes);
}

/* --------------------------------------------------------------------------------------- FM */

export interface FmParams {
  carrier: number;
  /** Modulator frequency as a multiple of the carrier (non-integer = metallic). */
  ratio: number;
  /** Modulation index at the start and at ~85 % of the duration. */
  idx0: number;
  idx1: number;
  at?: number;
  dur: number;
  attack?: number;
  gain: number;
  send?: number;
  lp?: number;
}

/** Two-operator FM: an inharmonic, quickly dulling metallic strike. */
export function fmHit(env: CueEnv, p: FmParams): void {
  const { ctx } = env;
  const t = env.t0 + (p.at ?? 0);
  const fc = p.carrier * env.pitch;
  const fm = fc * p.ratio;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  car.type = "sine";
  mod.type = "sine";
  car.frequency.setValueAtTime(fc, t);
  mod.frequency.setValueAtTime(fm, t);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(p.idx0 * fm, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(1e-3, p.idx1 * fm), t + p.dur * 0.85);
  mod.connect(depth);
  depth.connect(car.frequency);

  const nodes: AudioNode[] = [car, mod, depth];
  let tail: AudioNode = car;
  if (p.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = p.lp;
    car.connect(f);
    tail = f;
    nodes.push(f);
  }
  const g = ctx.createGain();
  applyEnvelope(g.gain, t, { peak: p.gain, attack: p.attack ?? 0.002, dur: p.dur });
  tail.connect(g);
  nodes.push(g, ...route(env, g, p.send));
  const end = t + p.dur + 0.03;
  car.start(t);
  mod.start(t);
  car.stop(end);
  mod.stop(end);
  car.onended = () => disconnectAll(nodes);
}

/* ---------------------------------------------------------------------------------- shimmer */

export interface ShimmerParams {
  at?: number;
  /** Pings are scattered over this many seconds. */
  window: number;
  count: number;
  fmin: number;
  fmax: number;
  gain: number;
  /** Ring time of each ping. */
  dur?: number;
  send?: number;
}

/** A scatter of tiny high pings: sparkle. */
export function shimmer(env: CueEnv, p: ShimmerParams): void {
  for (let i = 0; i < p.count; i++) {
    const at = (p.at ?? 0) + env.rand() * p.window;
    const f = p.fmin * (p.fmax / p.fmin) ** env.rand();
    tone(env, { freq: f, at, dur: p.dur ?? 0.14, attack: 0.003, gain: p.gain * (0.45 + env.rand() * 0.55), send: p.send, fixed: true });
  }
}

