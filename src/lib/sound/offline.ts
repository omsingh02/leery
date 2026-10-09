import type { BedName, Cue, CueOptions } from "../feel/contract";
import { renderAmbience, renderHeartbeat } from "./beds";
import { CUES, resolveOpts, trimGain } from "./cues";
import { jitter, mulberry32 } from "./dsp";
import { createMasterChain, createPlayBus } from "./graph";

/**
 * Renders cues and beds into an OfflineAudioContext with the very same master chain and cue code as the
 * live engine. Used by scripts/audio-check.mjs and the audio lab. Browser-only (needs OfflineAudioContext).
 */

export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
}

export interface RenderConfig {
  sampleRate?: number;
  /** Seed for noise offsets and ornaments. */
  seed?: number;
  /** Apply the per-play pitch jitter (off by default so renders are comparable). */
  jitter?: boolean;
  /** Render without the reverb (to measure a cue's own length). */
  dry?: boolean;
}

async function finish(ctx: OfflineAudioContext): Promise<Rendered> {
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()], sampleRate: buf.sampleRate };
}

/** Seconds a render of `cue` needs (delay + life + a small margin). */
export function renderLength(cue: Cue, opts?: CueOptions): number {
  const o = resolveOpts(opts);
  return o.delay + CUES[cue].life(o) + 0.05;
}

export async function renderCue(cue: Cue, opts?: CueOptions, cfg: RenderConfig = {}): Promise<Rendered> {
  const sampleRate = cfg.sampleRate ?? 48000;
  const spec = CUES[cue];
  const o = resolveOpts(opts);
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * renderLength(cue, opts)), sampleRate);
  const chain = createMasterChain(ctx, 1, { dry: cfg.dry });
  const rand = mulberry32(cfg.seed ?? 1);
  const bus = createPlayBus(chain, o.pan, trimGain(cue));
  spec.fn(
    { ctx, out: bus.out, send: bus.send, noise: chain.noise, t0: 0.004 + o.delay, rand, pitch: cfg.jitter ? jitter(rand, spec.jitter) : 1 },
    o,
  );
  return finish(ctx);
}

export async function renderBed(name: BedName, opts: { bpm?: number; level?: number; seconds?: number } = {}, cfg: RenderConfig = {}): Promise<Rendered> {
  const sampleRate = cfg.sampleRate ?? 48000;
  const seconds = opts.seconds ?? 4;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * (seconds + 0.9)), sampleRate);
  const chain = createMasterChain(ctx);
  if (name === "heartbeat") renderHeartbeat(chain, opts.bpm ?? 80, opts.level ?? 1, seconds, cfg.seed ?? 5);
  else renderAmbience(chain, opts.level ?? 1, seconds);
  return finish(ctx);
}
