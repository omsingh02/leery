import type { BedName, BedState, Cue, CueOptions } from "../feel/contract";
import { BedPlayer } from "./beds";
import { CUES, resolveOpts, trimGain } from "./cues";
import { VoicePool, gainJitter, jitter } from "./dsp";
import { createMasterChain, createPlayBus, MASTER_GAIN, type MasterChain, type PlayBus } from "./graph";

/** Simultaneous cue plays allowed before the lowest-priority/oldest are stolen. */
export const MAX_VOICES = 24;
/** Scheduling lead so a cue's very first sample is never "in the past". */
const LEAD = 0.004;

interface Play {
  bus: PlayBus;
  cue: Cue;
}

/**
 * The live audio engine: one AudioContext, one master chain, a voice budget and the beds.
 * Cues themselves live in cues.ts and run unchanged in the offline renderer.
 */
export class Engine {
  readonly chain: MasterChain;
  private readonly pool = new VoicePool<Play>(MAX_VOICES);
  private readonly lastStart = new Map<string, number>();
  private readonly beds = new Map<BedName, BedPlayer>();
  private readonly desired = new Map<BedName, BedState>();
  private silenced = false;

  constructor(
    readonly ctx: AudioContext,
    private readonly rand: () => number = Math.random,
  ) {
    this.chain = createMasterChain(ctx);
  }

  /** Cue plays currently sounding or ringing out (diagnostics). */
  get activeVoices(): number {
    return this.pool.size;
  }

  /** Make sure the context is running (browsers suspend it until a gesture, and again when backgrounded). */
  wake(): void {
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => undefined);
  }

  /** iOS needs a real (silent) buffer started inside a gesture to unlock output. */
  unlock(): void {
    this.wake();
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      /* best effort */
    }
  }

  play(cue: Cue, raw?: CueOptions): void {
    const spec = CUES[cue];
    if (!spec || this.silenced) return;
    // A suspended context freezes its clock: anything scheduled now would all burst out, late, on resume.
    if (this.ctx.state !== "running") {
      this.wake();
      return;
    }
    const o = resolveOpts(raw);
    const now = this.ctx.currentTime;

    // Double-fire guard (only for immediate plays — scheduled sequences legitimately stack).
    if (o.delay === 0) {
      const key = `${cue}:${o.pan.toFixed(1)}`;
      const prev = this.lastStart.get(key);
      if (prev !== undefined && now - prev < spec.minGap) return;
      this.lastStart.set(key, now);
    }

    const bus = createPlayBus(this.chain, o.pan, gainJitter(this.rand, 1) * trimGain(cue));
    const play: Play = { bus, cue };
    const verdict = this.pool.admit(play, spec.priority);
    if (!verdict.ok) {
      bus.dispose();
      return;
    }
    if (verdict.evicted) {
      const gone = verdict.evicted;
      gone.bus.steal(now);
      setTimeout(() => gone.bus.dispose(), 80);
    }

    try {
      spec.fn(
        {
          ctx: this.ctx,
          out: bus.out,
          send: bus.send,
          noise: this.chain.noise,
          t0: now + LEAD + o.delay,
          rand: this.rand,
          pitch: jitter(this.rand, spec.jitter),
        },
        o,
      );
    } catch {
      this.pool.release(play);
      bus.dispose();
      return;
    }
    setTimeout(
      () => {
        this.pool.release(play);
        bus.dispose();
      },
      (o.delay + spec.life(o) + 0.15) * 1000,
    );
  }

  /** Start/update/stop a bed. The wish is remembered so a mute/unmute cycle restores it. */
  bed(name: BedName, state: BedState): void {
    const merged = { ...this.desired.get(name), ...state };
    this.desired.set(name, merged);
    if (this.silenced) return;
    this.apply(name, merged);
  }

  private apply(name: BedName, state: BedState): void {
    let player = this.beds.get(name);
    if (!player) {
      if (!state.on) return;
      player = new BedPlayer(this.chain, name);
      this.beds.set(name, player);
    }
    player.set(state);
  }

  /** Mute: stop everything audible now, keep the beds' wishes. */
  silence(): void {
    this.silenced = true;
    const now = this.ctx.currentTime;
    this.chain.master.gain.cancelScheduledValues(now);
    this.chain.master.gain.setTargetAtTime(0, now, 0.01);
    for (const player of this.beds.values()) player.stop();
  }

  /** Unmute: bring the master back and restart whichever beds were wanted. */
  restore(): void {
    this.silenced = false;
    const now = this.ctx.currentTime;
    this.chain.master.gain.cancelScheduledValues(now);
    this.chain.master.gain.setTargetAtTime(MASTER_GAIN, now, 0.02);
    for (const [name, state] of this.desired) if (state.on) this.apply(name, state);
  }
}
