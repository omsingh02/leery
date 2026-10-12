import { clampPan, generateReverbIR, mulberry32, softClipCurve } from "./dsp";

/**
 * Pre-compressor master level. Cue gains are written against this. (2·√2: an unpanned mono play is scaled
 * by 1/√2 below so that every play — centre or hard left/right — has the same total power.)
 */
export const MASTER_GAIN = 2 * Math.SQRT2;
/** How loud the shared reverb comes back, relative to the sends. */
export const REVERB_RETURN = 0.8;

export interface MasterChain {
  ctx: BaseAudioContext;
  /** Dry bus: every play's dry signal (and the beds) arrive here. */
  input: GainNode;
  /** Reverb send bus. */
  reverbIn: GainNode;
  /** Final level before dynamics + safety clipper. */
  master: GainNode;
  /** Level of the reverb coming back into the mix (0 = a dry render, used to measure a cue's own length). */
  reverbReturn: GainNode;
  /** Shared white noise. */
  noise: AudioBuffer;
  /** Tears the chain down (live engine only). */
  dispose(): void;
}

/** White noise, seeded so offline renders are repeatable. */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2.5, seed = 20260901): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = mulberry32(seed);
  for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1;
  return buf;
}

/**
 * master gain → gentle compressor ("glue") → soft clipper (can't exceed −1.5 dBFS) → destination,
 * plus one small dark reverb fed by per-play send buses. Identical live and offline.
 */
export function createMasterChain(ctx: BaseAudioContext, seed = 1, opts: { dry?: boolean } = {}): MasterChain {
  const input = ctx.createGain();
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -9;
  comp.knee.value = 10;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;

  const clip = ctx.createWaveShaper();
  // Float32Array<ArrayBufferLike> vs the DOM's Float32Array<ArrayBuffer>: same data, different generics.
  clip.curve = softClipCurve() as Float32Array<ArrayBuffer>;
  clip.oversample = "2x";

  const reverbIn = ctx.createGain();
  const convolver = ctx.createConvolver();
  const [left, right] = generateReverbIR(ctx.sampleRate, 0.8, 7 + seed);
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  ir.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  convolver.normalize = false;
  convolver.buffer = ir;
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = opts.dry ? 0 : REVERB_RETURN;

  input.connect(master);
  reverbIn.connect(convolver);
  convolver.connect(reverbOut);
  reverbOut.connect(master);
  master.connect(comp);
  comp.connect(clip);
  clip.connect(ctx.destination);

  const nodes: AudioNode[] = [input, master, comp, clip, reverbIn, convolver, reverbOut];
  return {
    ctx,
    input,
    reverbIn,
    master,
    reverbReturn: reverbOut,
    noise: makeNoiseBuffer(ctx),
    dispose() {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}

export interface PlayBus {
  out: GainNode;
  send: GainNode;
  /** Fade out quickly (stolen voice) and disconnect. */
  steal(now: number): void;
  dispose(): void;
}

/** One cue play's private output stage: trim → (pan) → shared buses. */
export function createPlayBus(chain: MasterChain, pan: number, trim: number): PlayBus {
  const { ctx } = chain;
  const out = ctx.createGain();
  const send = ctx.createGain();
  const nodes: AudioNode[] = [out, send];
  const p = clampPan(pan);
  if (Math.abs(p) > 0.01 && "createStereoPanner" in ctx) {
    out.gain.value = trim;
    send.gain.value = trim;
    const pd = ctx.createStereoPanner();
    const pw = ctx.createStereoPanner();
    pd.pan.value = p;
    pw.pan.value = p;
    out.connect(pd);
    pd.connect(chain.input);
    send.connect(pw);
    pw.connect(chain.reverbIn);
    nodes.push(pd, pw);
  } else {
    // A mono source into a stereo bus plays at full level in both channels (twice the power of a panned
    // one, whose equal-power law keeps the total constant), so give the centre the same law.
    out.gain.value = trim * Math.SQRT1_2;
    send.gain.value = trim * Math.SQRT1_2;
    out.connect(chain.input);
    send.connect(chain.reverbIn);
  }
  return {
    out,
    send,
    steal(now: number) {
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.008);
      send.gain.cancelScheduledValues(now);
      send.gain.setTargetAtTime(0, now, 0.008);
    },
    dispose() {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}

