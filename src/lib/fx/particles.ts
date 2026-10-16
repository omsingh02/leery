import type { BurstKind, BurstOptions, Point, RingOptions } from "../feel/contract";
import { lighten, parseColor, PALETTE, rgbaCss, rgbCss, type Rgba } from "./color";
import type { Rng } from "./rng";

/**
 * The particle engine: framework-free, allocation-light, time-based.
 *
 * Particles live in struct-of-arrays typed arrays (a fixed pool, recycled oldest-first), so a frame
 * allocates nothing. Drawing uses small cached sprites (one per colour and shape) with
 * `globalAlpha`, so there are no gradients or colour strings built per particle per frame.
 * Coordinates are CSS pixels; `draw` takes the device-pixel ratio.
 */

/** Hard cap on live particles. A burst that doesn't fit recycles the oldest ones. */
export const MAX_PARTICLES = 400;
/** Concurrent rings. */
export const MAX_RINGS = 24;
/** Bursts waiting on their `delay`. */
const MAX_PENDING = 64;
/** One burst may recycle at most this share of the pool, so a big burst can't wipe out everything else. */
const RECYCLE_SHARE = 0.35;
const DEFAULT_POWER = 0.55;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const K_SPARKS = 0;
const K_DUST = 1;
const K_EMBERS = 2;
const K_CONFETTI = 3;
const K_SMOKE = 4;
const K_GLINTS = 5;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Options with every non-finite number (NaN, ±Infinity) dropped, so the defaults apply instead of poisoning the simulation. */
function finiteOnly<T extends object>(opts: T): T {
  const out: Record<string, unknown> = { ...(opts as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === "number" && !Number.isFinite(v)) delete out[key];
  }
  return out as T;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How a launch `power` (0–1) scales the speed range: 0 → ×0.4, default 0.55 → ×0.95, 1 → ×1.4. */
export const speedScale = (power: number): number => 0.4 + clamp01(power);

export interface KindSpec {
  /** Index used in the typed arrays. */
  id: number;
  /** Particles per burst when `count` isn't given. */
  count: number;
  /** One burst never exceeds this. */
  maxPerBurst: number;
  /** Launch speed range, px/s, at power scale ×1. */
  speed: readonly [number, number];
  /** Seconds. */
  life: readonly [number, number];
  /** px — line width for sparks, diameter for puffs/glints, flake width for confetti. */
  size: readonly [number, number];
  alpha: readonly [number, number];
  /** px/s² (negative rises). */
  gravity: number;
  /** 1/s exponential velocity damping. */
  drag: number;
  /** Default cone width, degrees. */
  spread: number;
  /** Random offset of the spawn point, px (glints scatter further, see `burst`). */
  jitter: number;
  colors: readonly string[];
}

const ORANGE = "hsl(24 95% 58%)";

export const KIND_SPECS: Record<BurstKind, KindSpec> = {
  sparks: { id: K_SPARKS, count: 14, maxPerBurst: 80, speed: [150, 560], life: [0.28, 0.72], size: [1, 2.6], alpha: [0.85, 1], gravity: 520, drag: 2.4, spread: 360, jitter: 0, colors: [PALETTE.gold, PALETTE.ivory, PALETTE.ivory, PALETTE.pink] },
  dust: { id: K_DUST, count: 7, maxPerBurst: 40, speed: [18, 120], life: [0.5, 0.95], size: [6, 14], alpha: [0.16, 0.3], gravity: -26, drag: 3.2, spread: 360, jitter: 4, colors: [PALETTE.ivory] },
  embers: { id: K_EMBERS, count: 9, maxPerBurst: 60, speed: [24, 100], life: [0.9, 1.8], size: [1.2, 2.8], alpha: [0.6, 1], gravity: -58, drag: 0.9, spread: 100, jitter: 6, colors: [PALETTE.gold, PALETTE.pink, ORANGE] },
  confetti: { id: K_CONFETTI, count: 34, maxPerBurst: 160, speed: [280, 780], life: [1.8, 3], size: [5, 10], alpha: [0.92, 1], gravity: 420, drag: 2.8, spread: 130, jitter: 4, colors: [PALETTE.violet, PALETTE.pink, PALETTE.gold, PALETTE.mint, PALETTE.red, PALETTE.ivory] },
  smoke: { id: K_SMOKE, count: 4, maxPerBurst: 20, speed: [20, 84], life: [0.95, 1.7], size: [18, 38], alpha: [0.12, 0.24], gravity: -22, drag: 1.5, spread: 70, jitter: 12, colors: ["#a99ad6"] },
  glints: { id: K_GLINTS, count: 5, maxPerBurst: 30, speed: [0, 10], life: [0.35, 0.8], size: [5, 13], alpha: [0.75, 1], gravity: 0, drag: 1, spread: 360, jitter: 10, colors: [PALETTE.ivory, PALETTE.gold, "#ffd6f0"] },
};

const KIND_BY_ID: BurstKind[] = ["sparks", "dust", "embers", "confetti", "smoke", "glints"];

/* ---------------------------------------------------------------------------------------- rings */

/** Radius, stroke width and opacity of a ring at progress `t` (0–1): ease-out growth, thinning, fading. */
export function ringShape(t: number, size: number, width: number): { radius: number; width: number; alpha: number } {
  const k = clamp01(t);
  return {
    radius: size * (0.12 + 0.88 * easeOutCubic(k)),
    width: width * (1 - 0.65 * k),
    alpha: 0.95 * Math.pow(1 - k, 1.35),
  };
}

interface Ring {
  alive: boolean;
  x: number;
  y: number;
  age: number;
  dur: number;
  size: number;
  width: number;
  css: string;
}

/* ------------------------------------------------------------------------------------- canvases */

/** The slice of a 2D context the engine uses — lets tests pass a recording fake. */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  "setTransform" | "globalAlpha" | "globalCompositeOperation" | "drawImage" | "strokeStyle" | "lineWidth" | "beginPath" | "arc" | "stroke"
>;

/** What a sprite factory returns (an HTMLCanvasElement in the browser). */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasRenderingContext2D | null;
}
export type CanvasFactory = (width: number, height: number) => CanvasLike | null;

const defaultCreateCanvas: CanvasFactory = (width, height) => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
};

type SpriteKind = "dot" | "ember" | "streak" | "star" | "flake" | "flakeRound";
const SPRITE_CACHE_LIMIT = 24;

function paintSprite(kind: SpriteKind, ctx: CanvasRenderingContext2D, w: number, h: number, c: Rgba) {
  const hot = lighten(c, 0.6);
  switch (kind) {
    case "dot": {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, rgbaCss(c, 1));
      g.addColorStop(0.45, rgbaCss(c, 0.55));
      g.addColorStop(1, rgbaCss(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "ember": {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, rgbaCss(hot, 1));
      g.addColorStop(0.12, rgbaCss(hot, 1));
      g.addColorStop(0.24, rgbaCss(c, 0.95));
      g.addColorStop(0.55, rgbaCss(c, 0.26));
      g.addColorStop(1, rgbaCss(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "streak": {
      // tail (left, transparent) → head (right, white-hot); a faint wider halo underneath
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgbaCss(c, 0));
      g.addColorStop(0.55, rgbaCss(c, 0.5));
      g.addColorStop(1, rgbaCss(hot, 1));
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(0, h * 0.12, w, h * 0.76);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(1, h / 2);
      ctx.lineTo(w - h * 0.28, h * 0.34);
      ctx.arc(w - h * 0.28, h / 2, h * 0.16, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(1, h / 2);
      ctx.fill();
      break;
    }
    case "star": {
      const cx = w / 2;
      const cy = h / 2;
      const arm = w / 2 - 1;
      const waist = arm * 0.1;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, arm * 0.5);
      glow.addColorStop(0, rgbaCss(hot, 0.7));
      glow.addColorStop(1, rgbaCss(c, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, arm);
      g.addColorStop(0, rgbaCss(hot, 1));
      g.addColorStop(1, rgbaCss(c, 0.85));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx + waist, cy - waist);
      ctx.lineTo(cx + arm, cy);
      ctx.lineTo(cx + waist, cy + waist);
      ctx.lineTo(cx, cy + arm);
      ctx.lineTo(cx - waist, cy + waist);
      ctx.lineTo(cx - arm, cy);
      ctx.lineTo(cx - waist, cy - waist);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "flake":
    case "flakeRound": {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgbaCss(lighten(c, 0.22), 1));
      g.addColorStop(1, rgbaCss(c, 1));
      ctx.fillStyle = g;
      ctx.beginPath();
      if (kind === "flakeRound") {
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, TAU);
      } else {
        const r = Math.min(2, h / 3);
        ctx.moveTo(r, 0);
        ctx.arcTo(w, 0, w, h, r);
        ctx.arcTo(w, h, 0, h, r);
        ctx.arcTo(0, h, 0, 0, r);
        ctx.arcTo(0, 0, w, 0, r);
        ctx.closePath();
      }
      ctx.fill();
      break;
    }
  }
}

const SPRITE_SIZE: Record<SpriteKind, [number, number]> = {
  dot: [64, 64],
  ember: [64, 64],
  streak: [64, 16],
  star: [48, 48],
  flake: [24, 16],
  flakeRound: [24, 16],
};

/* -------------------------------------------------------------------------------------- system */

export interface ParticleSystemOptions {
  /** Pool size. Defaults to MAX_PARTICLES. */
  max?: number;
  rng?: Rng;
  /** Where sprites are made. Defaults to document.createElement("canvas"). */
  createCanvas?: CanvasFactory;
}

interface PendingBurst {
  t: number;
  kind: BurstKind;
  x: number;
  y: number;
  count: number;
  opts: BurstOptions;
}

/** What `snapshot()` reports for each live particle (tests and the lab; allocates). */
export interface ParticleSnapshot {
  kind: BurstKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  alpha: number;
  color: [number, number, number];
}

export class ParticleSystem {
  readonly max: number;
  /** Multiplier on every burst's particle count (the frame governor lowers it on slow devices). */
  countScale = 1;
  private readonly rng: Rng;
  private readonly createCanvas: CanvasFactory;

  private n = 0; // live particles
  private head = 0; // next slot to write (oldest particle lives here once the pool wraps)
  private used = 0; // high-water mark: slots [0, used) may be live

  private readonly live: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly size2: Float32Array;
  private readonly rot: Float32Array;
  private readonly vrot: Float32Array;
  private readonly phase: Float32Array;
  private readonly aux1: Float32Array;
  private readonly aux2: Float32Array;
  private readonly grav: Float32Array;
  private readonly dragK: Float32Array;
  private readonly a0: Float32Array;
  private readonly cr: Uint8Array;
  private readonly cg: Uint8Array;
  private readonly cb: Uint8Array;
  private readonly round: Uint8Array;

  private readonly rings: Ring[] = [];
  private ringHead = 0;
  private readonly pending: PendingBurst[] = [];
  private readonly sprites: Record<SpriteKind, Map<number, CanvasLike>> = {
    dot: new Map(),
    ember: new Map(),
    streak: new Map(),
    star: new Map(),
    flake: new Map(),
    flakeRound: new Map(),
  };

  constructor(opts: ParticleSystemOptions = {}) {
    this.max = Math.max(1, Math.floor(opts.max ?? MAX_PARTICLES));
    this.rng = opts.rng ?? Math.random;
    this.createCanvas = opts.createCanvas ?? defaultCreateCanvas;
    const m = this.max;
    this.live = new Uint8Array(m);
    this.kind = new Uint8Array(m);
    this.x = new Float32Array(m);
    this.y = new Float32Array(m);
    this.vx = new Float32Array(m);
    this.vy = new Float32Array(m);
    this.age = new Float32Array(m);
    this.life = new Float32Array(m);
    this.size = new Float32Array(m);
    this.size2 = new Float32Array(m);
    this.rot = new Float32Array(m);
    this.vrot = new Float32Array(m);
    this.phase = new Float32Array(m);
    this.aux1 = new Float32Array(m);
    this.aux2 = new Float32Array(m);
    this.grav = new Float32Array(m);
    this.dragK = new Float32Array(m);
    this.a0 = new Float32Array(m);
    this.cr = new Uint8Array(m);
    this.cg = new Uint8Array(m);
    this.cb = new Uint8Array(m);
    this.round = new Uint8Array(m);
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ alive: false, x: 0, y: 0, age: 0, dur: 1, size: 0, width: 0, css: "" });
  }

  /** Live particles. */
  get alive(): number {
    return this.n;
  }

  get ringCount(): number {
    let c = 0;
    for (const r of this.rings) if (r.alive) c++;
    return c;
  }

  /** Bursts still waiting on their delay. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Anything to simulate or draw? The render loop runs exactly while this is true. */
  get active(): boolean {
    return this.n > 0 || this.pending.length > 0 || this.ringCount > 0;
  }

  /**
   * Emit a burst. Returns how many particles were emitted (or scheduled, when `delay` > 0) after
   * clamping to the per-burst cap and the recycle budget.
   */
  burst(kind: BurstKind, at: Point, options: BurstOptions = {}): number {
    const spec = KIND_SPECS[kind];
    if (!spec || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return 0;
    const opts = finiteOnly(options);
    const asked = Math.floor(opts.count ?? spec.count);
    const wanted = this.countScale === 1 || asked <= 0 ? asked : Math.max(1, Math.round(asked * this.countScale));
    const count = Math.max(0, Math.min(Number.isFinite(wanted) ? wanted : spec.count, spec.maxPerBurst));
    if (count === 0) return 0;
    const delay = Math.max(0, Math.min(10, opts.delay ?? 0));
    if (delay > 0) {
      if (this.pending.length >= MAX_PENDING) return 0;
      this.pending.push({ t: delay, kind, x: at.x, y: at.y, count, opts: { ...opts } });
      return count;
    }
    return this.emit(kind, at.x, at.y, count, opts, 0);
  }

  /** An expanding ring. Rings are recycled oldest-first beyond MAX_RINGS. */
  ring(at: Point, options: RingOptions = {}): void {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    const opts = finiteOnly(options);
    const delay = Math.max(0, Math.min(10, opts.delay ?? 0));
    let slot = this.rings.findIndex((r) => !r.alive);
    if (slot < 0) {
      slot = this.ringHead;
      this.ringHead = (this.ringHead + 1) % this.rings.length;
    }
    const r = this.rings[slot];
    r.alive = true;
    r.x = at.x;
    r.y = at.y;
    r.age = -delay;
    r.dur = Math.max(0.05, (opts.duration ?? 520) / 1000);
    r.size = Math.max(1, opts.size ?? 64);
    r.width = Math.max(0.5, opts.width ?? 2);
    r.css = rgbCss(parseColor(opts.color ?? PALETTE.ivory));
  }

  /** Advance the simulation by `dt` seconds (callers cap dt, e.g. at 0.05). */
  step(dt: number): void {
    if (!(dt > 0)) return;

    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0) continue;
      if (!this.integrate(i, dt)) {
        this.live[i] = 0;
        this.n--;
      }
    }

    for (const r of this.rings) {
      if (!r.alive) continue;
      r.age += dt;
      if (r.age >= r.dur) r.alive = false;
    }

    // Delayed bursts last, so what they emit isn't simulated twice: each new particle only gets the
    // part of this step that came after its scheduled moment.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      b.t -= dt;
      if (b.t > 0) continue;
      const last = this.pending.pop();
      if (i < this.pending.length && last) this.pending[i] = last;
      this.emit(b.kind, b.x, b.y, b.count, b.opts, -b.t);
    }
  }

  /** Remove everything (live, pending and rings). */
  clear(): void {
    this.live.fill(0);
    this.n = 0;
    this.head = 0;
    this.used = 0;
    this.pending.length = 0;
    for (const r of this.rings) r.alive = false;
  }

  /** The live particles, as plain objects. Allocates — for tests and debugging only. */
  snapshot(): ParticleSnapshot[] {
    const out: ParticleSnapshot[] = [];
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0) continue;
      out.push({
        kind: KIND_BY_ID[this.kind[i]],
        x: this.x[i],
        y: this.y[i],
        vx: this.vx[i],
        vy: this.vy[i],
        age: this.age[i],
        life: this.life[i],
        size: this.size[i],
        alpha: this.a0[i],
        color: [this.cr[i], this.cg[i], this.cb[i]],
      });
    }
    return out;
  }

  /** The live rings with their current shape. Allocates — for tests and debugging only. */
  ringSnapshot(): { x: number; y: number; radius: number; width: number; alpha: number; age: number }[] {
    return this.rings
      .filter((r) => r.alive)
      .map((r) => ({ x: r.x, y: r.y, age: r.age, ...ringShape(r.age / r.dur, r.size, r.width) }));
  }

  /* --------------------------------------------------------------------------------- spawning */

  private emit(kind: BurstKind, x0: number, y0: number, wanted: number, opts: BurstOptions, leftover: number): number {
    const spec = KIND_SPECS[kind];
    // Recycle budget: use the free slots, plus at most RECYCLE_SHARE of the pool.
    const allowed = this.max - this.n + Math.floor(this.max * RECYCLE_SHARE);
    // never more than the pool itself, or a burst would overwrite its own first particles
    const count = Math.min(wanted, allowed, this.max);
    if (count <= 0) return 0;

    const rng = this.rng;
    const power = clamp01(opts.power ?? DEFAULT_POWER);
    const scale = speedScale(power);
    const centre = opts.angle ?? -90;
    const spread = Math.max(0, Math.min(360, opts.spread ?? spec.spread));
    const colors = opts.color === undefined ? spec.colors : Array.isArray(opts.color) ? (opts.color.length ? opts.color : spec.colors) : [opts.color];

    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      if (i >= this.used) this.used = i + 1;
      if (this.live[i] === 0) this.n++;
      this.live[i] = 1;
      this.kind[i] = spec.id;

      // direction: uniform for wide bursts, centre-weighted (triangular) for cones
      const off = spread >= 300 ? (rng() - 0.5) * spread : (rng() + rng() - 1) * (spread / 2);
      const dir = (centre + off) * DEG;
      const speed = lerp(spec.speed[0], spec.speed[1], rng()) * scale;
      const life = lerp(spec.life[0], spec.life[1], rng());
      const col = parseColor(colors[Math.floor(rng() * colors.length)] ?? PALETTE.ivory);

      let px = x0;
      let py = y0;
      if (kind === "glints") {
        // glints don't fly: they twinkle in a small disc around the point
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * (10 + 46 * power);
        px += Math.cos(a) * r;
        py += Math.sin(a) * r;
      } else if (spec.jitter > 0) {
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * spec.jitter;
        px += Math.cos(a) * r;
        py += Math.sin(a) * r;
      }

      this.x[i] = px;
      this.y[i] = py;
      this.vx[i] = Math.cos(dir) * speed;
      this.vy[i] = Math.sin(dir) * speed;
      this.age[i] = 0;
      this.life[i] = life;
      this.size[i] = lerp(spec.size[0], spec.size[1], rng());
      this.size2[i] = 0;
      this.rot[i] = 0;
      this.vrot[i] = 0;
      this.phase[i] = rng() * TAU;
      this.aux1[i] = 0;
      this.aux2[i] = 0;
      this.grav[i] = spec.gravity;
      this.dragK[i] = spec.drag;
      this.a0[i] = lerp(spec.alpha[0], spec.alpha[1], rng()) * col.a;
      this.cr[i] = col.r;
      this.cg[i] = col.g;
      this.cb[i] = col.b;
      this.round[i] = 0;

      switch (spec.id) {
        case K_SPARKS:
          this.aux1[i] = lerp(0.035, 0.06, rng()); // streak length, in seconds of travel
          break;
        case K_EMBERS:
          this.aux1[i] = lerp(2.2, 4.6, rng()); // sway frequency (rad/s)
          this.aux2[i] = lerp(14, 40, rng()); // sway strength (px/s²)
          this.vrot[i] = lerp(5, 11, rng()); // flicker frequency (rad/s)
          break;
        case K_CONFETTI:
          this.size2[i] = this.size[i] * lerp(0.45, 0.7, rng());
          this.rot[i] = rng() * TAU;
          this.vrot[i] = (rng() < 0.5 ? -1 : 1) * lerp(2, 7, rng());
          this.aux1[i] = lerp(9, 22, rng()); // flutter frequency (rad/s)
          this.round[i] = rng() < 0.3 ? 1 : 0;
          break;
        case K_GLINTS:
          this.rot[i] = (rng() - 0.5) * 0.9;
          this.vrot[i] = (rng() - 0.5) * 1.6;
          break;
        default:
          break;
      }

      if (leftover > 0 && !this.integrate(i, leftover)) {
        this.live[i] = 0;
        this.n--;
      }
    }
    return count;
  }

  /** Advance one particle. Returns false when it has expired. */
  private integrate(i: number, dt: number): boolean {
    const age = this.age[i] + dt;
    if (age >= this.life[i]) return false;
    this.age[i] = age;

    const damp = Math.exp(-this.dragK[i] * dt);
    let vx = this.vx[i] * damp;
    const vy = this.vy[i] * damp + this.grav[i] * dt;
    const id = this.kind[i];
    if (id === K_EMBERS) vx += Math.sin(age * this.aux1[i] + this.phase[i]) * this.aux2[i] * dt;
    else if (id === K_CONFETTI) vx += Math.sin(age * 3.1 + this.phase[i]) * 24 * dt;

    this.vx[i] = vx;
    this.vy[i] = vy;
    this.x[i] += vx * dt;
    this.y[i] += vy * dt;
    if (id === K_CONFETTI || id === K_GLINTS) this.rot[i] += this.vrot[i] * dt;
    return true;
  }

  /* ---------------------------------------------------------------------------------- drawing */

  /** Draw everything onto `ctx`, whose backing store is `dpr` device pixels per CSS pixel. */
  draw(ctx: Ctx2D, dpr = 1): void {
    if (!this.active) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.drawPuffs(ctx, K_SMOKE);
    this.drawPuffs(ctx, K_DUST);
    this.drawFlakes(ctx, dpr);
    ctx.globalCompositeOperation = "lighter";
    this.drawEmbers(ctx);
    this.drawSparks(ctx, dpr);
    this.drawGlints(ctx, dpr);
    this.drawRings(ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private sprite(kind: SpriteKind, i: number): CanvasLike | null {
    const key = (this.cr[i] << 16) | (this.cg[i] << 8) | this.cb[i];
    const map = this.sprites[kind];
    let s = map.get(key);
    if (s) return s;
    const [w, h] = SPRITE_SIZE[kind];
    const canvas = this.createCanvas(w, h);
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return null;
    paintSprite(kind, g, w, h, { r: this.cr[i], g: this.cg[i], b: this.cb[i], a: 1 });
    if (map.size >= SPRITE_CACHE_LIMIT) map.clear();
    map.set(key, canvas);
    s = canvas;
    return s;
  }

  private drawPuffs(ctx: Ctx2D, id: number): void {
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0 || this.kind[i] !== id) continue;
      const t = this.age[i] / this.life[i];
      let d: number;
      let a: number;
      if (id === K_SMOKE) {
        d = this.size[i] * (1 + 1.2 * easeOutCubic(t));
        a = this.a0[i] * smoothstep(0, 0.15, t) * Math.pow(1 - t, 1.3);
      } else {
        d = this.size[i] * (1 + 0.9 * easeOutCubic(t));
        a = this.a0[i] * Math.min(1, t * 12) * Math.pow(1 - t, 1.5);
      }
      if (a <= 0.004) continue;
      const spr = this.sprite("dot", i);
      if (!spr) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(spr as unknown as CanvasImageSource, this.x[i] - d / 2, this.y[i] - d / 2, d, d);
    }
  }

  private drawEmbers(ctx: Ctx2D): void {
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0 || this.kind[i] !== K_EMBERS) continue;
      const t = this.age[i] / this.life[i];
      const flicker = 0.65 + 0.35 * Math.sin(this.age[i] * this.vrot[i] + this.phase[i]);
      const env = Math.min(1, t / 0.08) * (1 - smoothstep(0.55, 1, t));
      const a = this.a0[i] * flicker * env;
      if (a <= 0.004) continue;
      const spr = this.sprite("ember", i);
      if (!spr) continue;
      const d = this.size[i] * 5;
      ctx.globalAlpha = a;
      ctx.drawImage(spr as unknown as CanvasImageSource, this.x[i] - d / 2, this.y[i] - d / 2, d, d);
    }
  }

  private drawFlakes(ctx: Ctx2D, dpr: number): void {
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0 || this.kind[i] !== K_CONFETTI) continue;
      const t = this.age[i] / this.life[i];
      const flutter = Math.max(0.1, Math.abs(Math.cos(this.age[i] * this.aux1[i] + this.phase[i])));
      const a = this.a0[i] * (t < 0.8 ? 1 : (1 - t) / 0.2) * (0.72 + 0.28 * flutter);
      if (a <= 0.004) continue;
      const spr = this.sprite(this.round[i] ? "flakeRound" : "flake", i);
      if (!spr) continue;
      const c = Math.cos(this.rot[i]);
      const s = Math.sin(this.rot[i]);
      const w = this.size[i];
      const h = this.size2[i];
      ctx.setTransform(c * flutter * dpr, s * flutter * dpr, -s * dpr, c * dpr, this.x[i] * dpr, this.y[i] * dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(spr as unknown as CanvasImageSource, -w / 2, -h / 2, w, h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawSparks(ctx: Ctx2D, dpr: number): void {
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0 || this.kind[i] !== K_SPARKS) continue;
      const t = this.age[i] / this.life[i];
      const a = this.a0[i] * (1 - t * t);
      if (a <= 0.004) continue;
      const spr = this.sprite("streak", i);
      if (!spr) continue;
      const vx = this.vx[i];
      const vy = this.vy[i];
      const speed = Math.hypot(vx, vy);
      const len = Math.min(46, Math.max(4, speed * this.aux1[i]));
      const w = this.size[i] * (1 - 0.55 * t);
      const ang = Math.atan2(vy, vx);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, this.x[i] * dpr, this.y[i] * dpr);
      ctx.globalAlpha = a;
      // the sprite's right edge is the head: it sits on the particle, the tail trails behind
      ctx.drawImage(spr as unknown as CanvasImageSource, -len, -w * 1.2, len + w * 0.5, w * 2.4);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawGlints(ctx: Ctx2D, dpr: number): void {
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] === 0 || this.kind[i] !== K_GLINTS) continue;
      const t = this.age[i] / this.life[i];
      const pulse = Math.sin(Math.PI * t);
      const r = this.size[i] * Math.pow(Math.max(0, pulse), 1.2);
      const a = this.a0[i] * Math.min(1, pulse * 1.6);
      if (a <= 0.004 || r < 0.4) continue;
      const spr = this.sprite("star", i);
      if (!spr) continue;
      const c = Math.cos(this.rot[i]);
      const s = Math.sin(this.rot[i]);
      ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, this.x[i] * dpr, this.y[i] * dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(spr as unknown as CanvasImageSource, -r, -r, r * 2, r * 2);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawRings(ctx: Ctx2D): void {
    for (const r of this.rings) {
      if (!r.alive || r.age < 0) continue;
      const { radius, width, alpha } = ringShape(r.age / r.dur, r.size, r.width);
      if (alpha <= 0.004) continue;
      ctx.strokeStyle = r.css;
      // soft halo, then the crisp line
      ctx.globalAlpha = alpha * 0.22;
      ctx.lineWidth = width * 4;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.stroke();
    }
  }
}
