import type { Priority } from "./dsp";

/** A cue's options after clamping and defaulting (see `resolveOpts`). */
export interface ResolvedOpts {
  /** −1…1 */
  pan: number;
  n?: number;
  level?: number;
  dur?: number;
  /** Seconds, ≥ 0. */
  delay: number;
}

/**
 * Everything a cue needs to make sound. The same object shape is built by the live engine (on an
 * AudioContext) and by the offline renderer (on an OfflineAudioContext), so a cue is written once.
 */
export interface CueEnv {
  ctx: BaseAudioContext;
  /** Dry input: already trimmed and panned for this play. */
  out: AudioNode;
  /** Reverb send input: trimmed and panned like `out`. */
  send: AudioNode;
  /** Shared white-noise buffer (a couple of seconds). */
  noise: AudioBuffer;
  /** Start time on the context's clock, seconds. */
  t0: number;
  /** Per-play randomness in [0, 1). Deterministic offline. */
  rand: () => number;
  /** Pitch multiplier for this play (≈ 1 ± a small jitter). Cues multiply their pitched frequencies by it. */
  pitch: number;
}

export type CueFn = (env: CueEnv, o: ResolvedOpts) => void;

export type LoudnessGroup = "regular" | "quiet" | "impact";

export interface CueSpec {
  fn: CueFn;
  /** Target audible length in seconds — what scripts/audio-check.mjs compares the render against. */
  target: number;
  /** Upper bound of the cue's life including its reverb tail, seconds (drives clean-up and render length). */
  life: (o: ResolvedOpts) => number;
  /** Who survives when the voice budget is full. 2 = never evicted. */
  priority: Priority;
  /** Loudness class for the offline consistency check. */
  group: LoudnessGroup;
  /** ± pitch jitter applied per play (tonal cues keep it small so ladders stay in tune). */
  jitter: number;
  /** Minimum seconds between two plays of this cue (guards against double-fires). */
  minGap: number;
  /** Loudness calibration in dB (measured by scripts/audio-check.mjs --calibrate), applied to the play's output. */
  trimDb: number;
}
