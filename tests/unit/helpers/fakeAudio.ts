/**
 * A recording fake of just enough Web Audio to run Leery's real Engine (graph, voices, cues, beds) in Node:
 * nodes remember what was connected/started/stopped, params reject non-finite values and impossible ramps
 * the way a browser would throw, and the clock only moves when a test moves it.
 */
const PARAMS = new Set(["gain", "frequency", "detune", "Q", "pan", "threshold", "knee", "ratio", "attack", "release"]);

export class FakeParam {
  value = 1;
  events: { kind: string; v: number; t: number }[] = [];
  private check(v: number, t: number, what: string) {
    if (!Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${v}`);
    if (!Number.isFinite(t)) throw new TypeError(`${what}: non-finite time ${t}`);
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t, "setValueAtTime");
    this.events.push({ kind: "set", v, t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "linearRamp");
    this.events.push({ kind: "linear", v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "exponentialRamp");
    if (!(v > 0)) throw new RangeError("exponentialRamp to a value <= 0");
    this.events.push({ kind: "exp", v, t });
    return this;
  }
  setTargetAtTime(v: number, t: number) {
    this.check(v, t, "setTarget");
    this.events.push({ kind: "target", v, t });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push({ kind: "cancel", v: 0, t });
    return this;
  }
}

export class FakeNode {
  onended: (() => void) | null = null;
  type = "";
  buffer: unknown = null;
  loop = false;
  curve: unknown = null;
  oversample = "none";
  normalize = true;
  started: number | null = null;
  stopped: number | null = null;
  disconnects = 0;
  private readonly params = new Map<string, FakeParam>();
  [param: string]: unknown;

  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string" && PARAMS.has(prop) && !(prop in target)) {
          let param = target.params.get(prop);
          if (!param) target.params.set(prop, (param = new FakeParam()));
          return param;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
  connect<T>(to: T): T {
    return to;
  }
  disconnect() {
    this.disconnects++;
  }
  start(t = 0) {
    this.started = t;
    this.ctx.sources.push(this);
  }
  stop(t = 0) {
    this.stopped = t;
  }
}

export class FakeContext {
  static all: FakeContext[] = [];
  /** Make createDynamicsCompressor throw (the engine can't be built). */
  static breakGraph = false;
  /** New contexts start suspended and only run once the test calls `settleResume()` (a browser deciding to allow audio). */
  static slowResume = false;

  state: "suspended" | "running" | "interrupted" | "closed" = "suspended";
  currentTime = 0;
  sampleRate = 48000;
  nodes: FakeNode[] = [];
  sources: FakeNode[] = [];
  resumeCalls = 0;
  closed = false;
  /** What resume() does; by default it settles at once and the context is running. */
  resumeImpl: () => Promise<void> = () => {
    this.state = "running";
    return Promise.resolve();
  };
  /** With `slowResume`: lets the pending resume() finish. */
  settleResume: () => void = () => undefined;
  readonly destination: FakeNode;

  constructor(readonly options?: unknown) {
    FakeContext.all.push(this);
    this.destination = new FakeNode(this, "destination");
    if (FakeContext.slowResume) {
      // like a browser: every resume() while one is pending gets the same promise
      let pending: Promise<void> | null = null;
      this.resumeImpl = () =>
        (pending ??= new Promise<void>((resolve) => {
          this.settleResume = () => {
            this.state = "running";
            resolve();
          };
        }));
    }
  }
  resume() {
    this.resumeCalls++;
    return this.resumeImpl();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode(this, "gain");
  }
  createOscillator() {
    return new FakeNode(this, "oscillator");
  }
  createBiquadFilter() {
    return new FakeNode(this, "biquad");
  }
  createBufferSource() {
    return new FakeNode(this, "bufferSource");
  }
  createWaveShaper() {
    return new FakeNode(this, "shaper");
  }
  createDynamicsCompressor() {
    if (FakeContext.breakGraph) throw new Error("no compressor here");
    return new FakeNode(this, "compressor");
  }
  createConvolver() {
    return new FakeNode(this, "convolver");
  }
  createStereoPanner() {
    return new FakeNode(this, "panner");
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(Math.min(length, 8)));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i: number) => data[i], copyToChannel() {} };
  }
  get oscillators() {
    return this.sources.filter((n) => n.kind === "oscillator");
  }
}
