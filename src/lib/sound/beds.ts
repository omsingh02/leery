import type { BedName, BedState } from "../feel/contract";
import { advanceHeart, beatsBetween, clamp, clamp01, mulberry32, type Beat, type HeartClock } from "./dsp";
import type { MasterChain } from "./graph";
import type { CueEnv } from "./types";
import { noiseBurst, thump } from "./voices";

/** Continuous beds: a heartbeat that quickens with tension, and a barely-there room tone. */

/** Seconds of audio the live scheduler keeps queued ahead of the clock. */
const LOOKAHEAD = 0.25;
/** Bed bus level at `level` 1: the heartbeat is a texture under the game, never louder than a cue. */
const HEART_MAX = 0.22;
/** Ambience at `level` 1: a room tone you only notice when it stops. */
const AMBIENCE_MAX = 0.05;
const TICK_MS = 40;
const FADE = 0.15;

/** Environment for a one-off sound at absolute time `t` on a bed's own bus. */
function envAt(chain: MasterChain, out: AudioNode, t: number, rand: () => number): CueEnv {
  return { ctx: chain.ctx, out, send: chain.reverbIn, noise: chain.noise, t0: t, rand, pitch: 1 };
}

/** One "lub" or "dub": a saturated low thump (so small speakers get its harmonics) plus a tiny chest knock. */
export function heartbeatBeat(env: CueEnv, kind: "lub" | "dub"): void {
  if (kind === "lub") {
    thump(env, { f0: 86, f1: 50, glide: 0.09, dur: 0.22, gain: 0.5, drive: 3, lp: 320 });
    noiseBurst(env, { dur: 0.05, attack: 0.004, gain: 0.22, lp: 320 });
  } else {
    thump(env, { f0: 78, f1: 48, glide: 0.08, dur: 0.18, gain: 0.32, drive: 3, lp: 300 });
    noiseBurst(env, { dur: 0.04, attack: 0.004, gain: 0.14, lp: 300 });
  }
}

export function scheduleBeats(chain: MasterChain, bus: AudioNode, beats: Beat[], rand: () => number): void {
  for (const b of beats) heartbeatBeat(envAt(chain, bus, b.t, rand), b.kind);
}

/** The ambience graph: looped noise → slowly breathing lowpass → gentle level. Returns its output node and a stop function. */
export function buildAmbience(chain: MasterChain, bus: AudioNode, start: number, stop?: number): () => void {
  const { ctx } = chain;
  const src = ctx.createBufferSource();
  src.buffer = chain.noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 380;
  lp.Q.value = 0.6;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 70;
  const cutLfo = ctx.createOscillator();
  const cutDepth = ctx.createGain();
  cutLfo.frequency.value = 0.07;
  cutDepth.gain.value = 140;
  cutLfo.connect(cutDepth);
  cutDepth.connect(lp.frequency);
  const breath = ctx.createGain();
  breath.gain.value = 0.7;
  const ampLfo = ctx.createOscillator();
  const ampDepth = ctx.createGain();
  ampLfo.frequency.value = 0.11;
  ampDepth.gain.value = 0.3;
  ampLfo.connect(ampDepth);
  ampDepth.connect(breath.gain);
  src.connect(hp);
  hp.connect(lp);
  lp.connect(breath);
  breath.connect(bus);
  const nodes: AudioNode[] = [src, lp, hp, cutLfo, cutDepth, breath, ampLfo, ampDepth];
  src.start(start, 0);
  cutLfo.start(start);
  ampLfo.start(start);
  const halt = (at: number) => {
    for (const s of [src, cutLfo, ampLfo]) {
      try {
        s.stop(at);
      } catch {
        /* never started / already stopped */
      }
    }
  };
  if (stop !== undefined) halt(stop);
  src.onended = () => nodes.forEach((n) => n.disconnect());
  return () => halt(ctx.currentTime);
}

/** Renders a heartbeat into an (offline) chain: every beat in [0, seconds). */
export function renderHeartbeat(chain: MasterChain, bpm: number, level: number, seconds: number, seed = 5): void {
  const bus = chain.ctx.createGain();
  bus.gain.value = clamp01(level) * HEART_MAX;
  bus.connect(chain.input);
  scheduleBeats(chain, bus, beatsBetween(0, seconds, bpm, 0.05), mulberry32(seed));
}

export function renderAmbience(chain: MasterChain, level: number, seconds: number): void {
  const bus = chain.ctx.createGain();
  bus.gain.value = clamp01(level) * AMBIENCE_MAX;
  bus.connect(chain.input);
  buildAmbience(chain, bus, 0, seconds);
}

/* ---------------------------------------------------------------------------- live controller */

/** Plays one bed on the live context. Idempotent: `set()` starts, updates or stops depending on `on`. */
export class BedPlayer {
  private bus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock: HeartClock = { next: 0 };
  private stopAmbience: (() => void) | null = null;
  private bpm = 70;
  private level = 0.6;
  private running = false;
  private readonly rand = Math.random;

  constructor(
    private readonly chain: MasterChain,
    private readonly name: BedName,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  set(state: BedState): void {
    if (state.bpm !== undefined) this.bpm = clamp(state.bpm, 40, 180);
    if (state.level !== undefined) this.level = clamp01(state.level);
    if (!state.on) return this.stop();
    if (!this.running) this.start();
    this.applyLevel();
  }

  private busLevel(): number {
    return this.name === "ambience" ? this.level * AMBIENCE_MAX : this.level * HEART_MAX;
  }

  private applyLevel(): void {
    if (!this.bus) return;
    const now = this.chain.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(this.busLevel(), now, FADE / 3);
  }

  private start(): void {
    const { ctx } = this.chain;
    this.running = true;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(this.chain.input);
    this.bus = bus;
    const now = ctx.currentTime;
    if (this.name === "heartbeat") {
      this.clock = { next: now + 0.05 };
      const pump = () => {
        const until = ctx.currentTime + LOOKAHEAD;
        scheduleBeats(this.chain, bus, advanceHeart(this.clock, until, this.bpm), this.rand);
      };
      pump();
      this.timer = setInterval(pump, TICK_MS);
    } else {
      this.stopAmbience = buildAmbience(this.chain, bus, now);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const bus = this.bus;
    this.bus = null;
    if (!bus) return;
    const { ctx } = this.chain;
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(0, now, FADE / 3);
    const halt = this.stopAmbience;
    this.stopAmbience = null;
    setTimeout(() => {
      halt?.();
      try {
        bus.disconnect();
      } catch {
        /* gone */
      }
    }, FADE * 1000 * 2.5);
  }

  /** Silence immediately-ish but remember nothing (the engine re-applies desired state on unmute). */
  dispose(): void {
    this.stop();
  }
}
