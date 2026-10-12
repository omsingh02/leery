import { describe, expect, it } from "vitest";
import type { Cue, CueOptions } from "@/lib/feel/contract";
import { CUES, CUE_NAMES, resolveOpts, trimGain } from "@/lib/sound/cues";
import { mulberry32 } from "@/lib/sound/dsp";
import type { CueEnv } from "@/lib/sound/types";

/** Every cue named in src/lib/feel/contract.ts. If the contract grows, this list (and the cue table) must too. */
const CONTRACT_CUES: Cue[] = [
  "tap", "toggle", "error", "copy", "join", "leave",
  "select", "deselect", "limit", "wave",
  "whoosh", "land",
  "turn", "turnOther", "tick", "buzzer",
  "accept", "acceptOther", "call",
  "drumroll", "flip", "good", "badCard", "verdictBluff", "verdictHonest",
  "pickup", "cardTick", "lastCard",
  "shuffle", "deal", "win", "lose",
];

/* ------------------------------------------------------------------------------ a recording fake */

type Log = { kind: string; name: string; v?: number; t?: number; /** when a bounded buffer source (noise burst) stops by itself */ end?: number }[];

class FakeParam {
  value: number;
  constructor(
    private readonly log: Log,
    private readonly name: string,
    v = 1,
  ) {
    this.value = v;
  }
  private check(v: number, t: number, what: string): void {
    if (!Number.isFinite(v)) throw new Error(`${this.name}.${what}: non-finite value ${v}`);
    if (!Number.isFinite(t) || t < 0) throw new Error(`${this.name}.${what}: bad time ${t}`);
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t, "set");
    this.log.push({ kind: "set", name: this.name, v, t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "linear");
    this.log.push({ kind: "linear", name: this.name, v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "exp");
    if (!(v > 0)) throw new RangeError(`${this.name}: exponential ramp to ${v} (browsers throw on ≤ 0)`);
    this.log.push({ kind: "exp", name: this.name, v, t });
    return this;
  }
  setTargetAtTime(v: number, t: number) {
    this.check(v, t, "target");
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  onended: (() => void) | null = null;
  type = "";
  buffer: unknown = null;
  loop = false;
  curve: unknown = null;
  gain: FakeParam;
  frequency: FakeParam;
  detune: FakeParam;
  Q: FakeParam;
  constructor(
    private readonly log: Log,
    readonly kind: string,
  ) {
    this.gain = new FakeParam(log, `${kind}.gain`);
    this.frequency = new FakeParam(log, `${kind}.frequency`, 440);
    this.detune = new FakeParam(log, `${kind}.detune`, 0);
    this.Q = new FakeParam(log, `${kind}.Q`, 1);
  }
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {}
  start(t = 0, offset = 0, dur?: number): void {
    this.log.push({ kind: "start", name: this.kind, v: dur ?? offset, t, end: dur === undefined ? undefined : t + dur });
  }
  stop(t = 0): void {
    this.log.push({ kind: "stop", name: this.kind, t });
  }
}

function fakeContext(log: Log) {
  const make = (kind: string) => () => new FakeNode(log, kind);
  return {
    sampleRate: 48000,
    currentTime: 0,
    destination: new FakeNode(log, "destination"),
    createGain: make("gain"),
    createOscillator: make("osc"),
    createBiquadFilter: make("biquad"),
    createBufferSource: make("buffer"),
    createWaveShaper: make("shaper"),
  } as unknown as BaseAudioContext;
}

const T0 = 2;

function run(cue: Cue, opts: CueOptions | undefined, seed = 3) {
  const log: Log = [];
  const ctx = fakeContext(log);
  const dest = new FakeNode(log, "bus");
  const env: CueEnv = {
    ctx,
    out: dest as unknown as AudioNode,
    send: dest as unknown as AudioNode,
    noise: { duration: 2.5 } as AudioBuffer,
    t0: T0,
    rand: mulberry32(seed),
    pitch: 1,
  };
  const o = resolveOpts(opts);
  CUES[cue].fn(env, o);
  return { log, o };
}

/* ------------------------------------------------------------------------------------- the tests */

describe("cue table", () => {
  it("covers exactly the cues in the contract", () => {
    expect([...CUE_NAMES].sort()).toEqual([...CONTRACT_CUES].sort());
  });

  it("gives every cue sane metadata", () => {
    for (const cue of CUE_NAMES) {
      const s = CUES[cue];
      expect(s.target, cue).toBeGreaterThan(0);
      expect(s.life(resolveOpts()), cue).toBeGreaterThanOrEqual(s.target);
      expect([0, 1, 2], cue).toContain(s.priority);
      expect(["regular", "quiet", "impact"], cue).toContain(s.group);
      expect(s.jitter, cue).toBeGreaterThan(0);
      expect(s.jitter, cue).toBeLessThanOrEqual(0.03);
      expect(s.minGap, cue).toBeGreaterThanOrEqual(0);
      expect(Math.abs(s.trimDb), cue).toBeLessThanOrEqual(15); // a bigger calibration trim means the recipe itself is badly out of balance
      expect(trimGain(cue), cue).toBeCloseTo(10 ** (s.trimDb / 20), 12);
    }
  });

  it("never evicts the cues that matter most", () => {
    for (const cue of ["turn", "call", "land", "verdictBluff", "verdictHonest", "win", "lose", "buzzer", "error", "lastCard"] as Cue[]) {
      expect(CUES[cue].priority, cue).toBe(2);
    }
    for (const cue of ["tap", "tick", "cardTick", "turnOther", "acceptOther", "deal"] as Cue[]) {
      expect(CUES[cue].priority, cue).toBe(0);
    }
  });
});

describe("resolveOpts", () => {
  it("clamps and defaults", () => {
    expect(resolveOpts()).toEqual({ pan: 0, n: undefined, level: undefined, dur: undefined, delay: 0 });
    expect(resolveOpts({ pan: 9, level: 7, dur: 99, delay: 99 })).toEqual({ pan: 1, n: undefined, level: 1, dur: 4, delay: 10 });
    expect(resolveOpts({ pan: -9, level: -2, dur: 0.001, delay: -4 })).toEqual({ pan: -1, n: undefined, level: 0, dur: 0.02, delay: 0 });
  });

  it("ignores NaN and non-finite numbers", () => {
    const o = resolveOpts({ pan: Number.NaN, n: Number.NaN, level: Number.POSITIVE_INFINITY, dur: Number.NaN, delay: Number.NaN });
    expect(o).toEqual({ pan: 0, n: undefined, level: undefined, dur: undefined, delay: 0 });
  });

  it("keeps meaningful values", () => {
    expect(resolveOpts({ n: 3, level: 0.4, dur: 0.5, pan: -0.25, delay: 0.1 })).toEqual({ n: 3, level: 0.4, dur: 0.5, pan: -0.25, delay: 0.1 });
  });
});

describe("every cue schedules valid Web Audio automation", () => {
  const MATRIX: (CueOptions | undefined)[] = [
    undefined,
    { n: 0 },
    { n: 1 },
    { n: 4 },
    { n: 99 },
    { n: -3 },
    { level: 0 },
    { level: 1 },
    { dur: 0.02 },
    { dur: 4 },
    { pan: -1 },
    { pan: 1 },
    { n: 2, level: 0.5, dur: 0.5 },
  ];

  for (const cue of CONTRACT_CUES) {
    it(cue, () => {
      for (const opts of MATRIX) {
        const { log, o } = run(cue, opts); // the fake throws on non-finite values/times and on exponential ramps to ≤ 0
        const starts = log.filter((e) => e.kind === "start");
        const stops = log.filter((e) => e.kind === "stop");
        expect(starts.length, `${cue} ${JSON.stringify(opts)} makes no sound`).toBeGreaterThan(0);
        expect(starts.length, `${cue} ${JSON.stringify(opts)} uses too many sources`).toBeLessThanOrEqual(120);
        for (const s of starts) expect(s.t ?? 0).toBeGreaterThanOrEqual(T0 - 1e-9);
        // …including noise bursts, which end by themselves (start(t, offset, duration)) rather than by stop()
        const lastStop = Math.max(...stops.map((e) => e.t ?? 0), ...starts.map((e) => e.end ?? e.t ?? 0));
        expect(lastStop - T0, `${cue} ${JSON.stringify(opts)} outlives its declared life`).toBeLessThanOrEqual(CUES[cue].life(o));
        // every oscillator frequency we set is a plausible, audible pitch
        for (const e of log) {
          if (e.kind !== "set" || !e.name.endsWith("osc.frequency")) continue;
          expect(e.v ?? 0, `${cue} oscillator frequency`).toBeGreaterThan(15);
          expect(e.v ?? 0, `${cue} oscillator frequency`).toBeLessThan(12000);
        }
      }
    });
  }

  it("is deterministic for a given seed and varies between seeds (noise offsets, ornaments)", () => {
    expect(JSON.stringify(run("shuffle", undefined, 5).log)).toBe(JSON.stringify(run("shuffle", undefined, 5).log));
    expect(JSON.stringify(run("shuffle", undefined, 5).log)).not.toBe(JSON.stringify(run("shuffle", undefined, 6).log));
    expect(JSON.stringify(run("win", undefined, 1).log)).not.toBe(JSON.stringify(run("win", undefined, 2).log));
  });

  it("select climbs with the selection count and deselect falls with it", () => {
    const first = (cue: Cue, n: number) => run(cue, { n }).log.find((e) => e.kind === "set" && e.name === "osc.frequency")?.v ?? 0;
    expect(first("select", 2)).toBeGreaterThan(first("select", 1));
    expect(first("select", 4)).toBeGreaterThan(first("select", 3));
    expect(first("deselect", 3)).toBeGreaterThan(first("deselect", 0));
  });

  it("louder landings for more cards", () => {
    const peak = (n: number) =>
      Math.max(...run("land", { n, level: 0.5 }).log.filter((e) => e.kind === "linear" && e.name.endsWith("gain")).map((e) => e.v ?? 0));
    expect(peak(4)).toBeGreaterThan(peak(1));
  });
});
