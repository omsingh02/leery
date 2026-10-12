/**
 * Screen shake, trauma-style (after Squirrel Eiserloh's "Juicing your cameras with math").
 *
 * Every call adds trauma (0–1, clamped); the shake you see is trauma² × a smooth noise signal, so a
 * little trauma barely trembles and a lot really hits. Trauma decays linearly to zero by the latest
 * requested end time, so overlapping shakes extend rather than restart each other. The offsets are
 * handed to a target as --fx-sx, --fx-sy (px) and --fx-sr (deg) — by default custom properties on the
 * root element; the app passes a writer that moves the registered elements instead (see
 * ./shakeTargets.ts). The rAF loop runs only while there is trauma.
 */

export interface ShakeTarget {
  style: { setProperty(name: string, value: string): void };
}

export interface ShakeOptions {
  /** Where the CSS variables are written. Defaults to document.documentElement. */
  target?: ShakeTarget;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  /** Milliseconds on the same clock as the rAF timestamp. Defaults to performance.now(). */
  now?: () => number;
  /** Peak translation in px at trauma 1. */
  maxOffset?: number;
  /** Peak rotation in degrees at trauma 1. */
  maxRot?: number;
  /** Shape of the trauma → shake curve (2 = classic). */
  exponent?: number;
}

export const DEFAULT_DURATION_MS = 300;
const DEFAULT_MAX_OFFSET = 10;
const DEFAULT_MAX_ROT = 1.2;

/**
 * Smooth pseudo-noise in [-1, 1]: three incommensurate sines. `seed` decorrelates the axes.
 * Frequencies are chosen so the motion reads as a fast rumble (≈10–20 Hz), not white jitter.
 */
export function smoothNoise(timeSec: number, seed: number): number {
  const t = timeSec;
  const v =
    Math.sin(t * 71 + seed * 12.9898) +
    0.6 * Math.sin(t * 113 + seed * 78.233 + 1.7) +
    0.4 * Math.sin(t * 29 + seed * 37.719 + 4.1);
  return v / 2;
}

/** The pure part: offsets for a given trauma at a moment in time. */
export function shakeOffsets(
  timeSec: number,
  trauma: number,
  opts: Pick<ShakeOptions, "maxOffset" | "maxRot" | "exponent"> = {},
): { x: number; y: number; r: number } {
  const amount = Math.pow(Math.max(0, Math.min(1, trauma)), opts.exponent ?? 2);
  const maxOffset = opts.maxOffset ?? DEFAULT_MAX_OFFSET;
  const maxRot = opts.maxRot ?? DEFAULT_MAX_ROT;
  // `+ 0` turns a negative zero into a plain one, so the CSS never reads "-0.00px"
  return {
    x: amount * maxOffset * smoothNoise(timeSec, 1) + 0,
    y: amount * maxOffset * smoothNoise(timeSec, 2) + 0,
    r: amount * maxRot * smoothNoise(timeSec, 3) + 0,
  };
}

export interface Shake {
  /** Add `intensity` (0–1) of trauma, lasting `durationMs` from now. */
  add(intensity: number, durationMs?: number): void;
  /** Stop immediately and reset the CSS variables. */
  cancel(): void;
  /** Trauma right now, 0–1. */
  readonly trauma: number;
  /** Is the loop running? */
  readonly active: boolean;
}

export function createShake(opts: ShakeOptions = {}): Shake {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const getTarget = (): ShakeTarget | null => opts.target ?? (typeof document !== "undefined" ? document.documentElement : null);

  // trauma(t) = trauma0 × (end − t) / (end − t0): linear, closed form, independent of frame rate
  let trauma0 = 0;
  let t0 = 0;
  let end = 0;
  let rafId = 0;
  let wrote = false;

  const traumaAt = (t: number): number => {
    if (trauma0 <= 0 || t >= end) return 0;
    return trauma0 * Math.max(0, (end - t) / Math.max(1, end - t0));
  };

  const write = (x: number, y: number, r: number) => {
    const target = getTarget();
    if (!target) return;
    target.style.setProperty("--fx-sx", `${x.toFixed(2)}px`);
    target.style.setProperty("--fx-sy", `${y.toFixed(2)}px`);
    target.style.setProperty("--fx-sr", `${r.toFixed(3)}deg`);
    wrote = true;
  };

  const reset = () => {
    trauma0 = 0;
    if (wrote) write(0, 0, 0);
    wrote = false;
  };

  const tick = (ts: number) => {
    rafId = 0;
    const t = Number.isFinite(ts) ? ts : now();
    const tr = traumaAt(t);
    if (tr <= 0) {
      reset();
      return;
    }
    const o = shakeOffsets(t / 1000, tr, opts);
    write(o.x, o.y, o.r);
    rafId = raf(tick);
  };

  return {
    add(intensity, durationMs = DEFAULT_DURATION_MS) {
      if (!(intensity > 0) || !(durationMs > 0)) return;
      const t = now();
      const current = traumaAt(t);
      trauma0 = Math.min(1, current + Math.min(1, intensity));
      t0 = t;
      end = Math.max(t < end ? end : 0, t + durationMs);
      if (!rafId) rafId = raf(tick);
    },
    cancel() {
      if (rafId) caf(rafId);
      rafId = 0;
      reset();
    },
    get trauma() {
      return traumaAt(now());
    },
    get active() {
      return rafId !== 0;
    },
  };
}
