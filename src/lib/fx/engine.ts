import type { BurstKind, BurstOptions, FxController, Point, RingOptions } from "../feel/contract";
import { prefs } from "../prefs";
import { parseColor, rgbaCss, type Rgba } from "./color";
import { MAX_PARTICLES, ParticleSystem, type CanvasFactory } from "./particles";
import type { Rng } from "./rng";
import { createShake, DEFAULT_DURATION_MS, type Shake, type ShakeTarget } from "./shake";

/**
 * The FX runtime: owns the particle system, the canvas render loop, the flash and vignette layers and
 * the screen shake, and implements `FxController` with the reduced-effects policy applied.
 * Everything that touches the page is injectable, so the whole thing runs under test without a DOM.
 */

/** A vignette stays at or below this when effects are reduced, and eases slowly so it can't pulse. */
export const REDUCED_VIGNETTE_CAP = 0.35;
const VIGNETTE_EASE_MS = 250;
const REDUCED_VIGNETTE_EASE_MS = 700;
/** Edge colour of a vignette when the caller doesn't pick one: a deep, tense red. */
export const DEFAULT_VIGNETTE_COLOR = "hsl(348 90% 32%)";
export const DEFAULT_FLASH_PEAK = 0.35;
export const DEFAULT_FLASH_MS = 220;
/** The longest step the simulation will take, so a stalled frame never teleports particles. */
export const MAX_DT = 0.05;

interface StyleLike {
  opacity: string;
  visibility: string;
  background: string;
  transition: string;
  willChange?: string;
}
interface LayerLike {
  style: StyleLike;
  animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => { cancel(): void };
  offsetWidth?: number;
}
interface CanvasEl {
  width: number;
  height: number;
  style: { visibility: string };
  getContext(type: "2d"): CanvasRenderingContext2D | null;
}

interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio?: number;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
  visualViewport?: { addEventListener(type: string, cb: () => void): void; removeEventListener(type: string, cb: () => void): void } | null;
}
interface DocumentLike {
  hidden: boolean;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

export interface FxEngineDeps {
  canvas: CanvasEl | null;
  flash: LayerLike | null;
  vignette: LayerLike | null;
  win?: WindowLike | null;
  doc?: DocumentLike | null;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  /** Milliseconds, same clock as the rAF timestamps. */
  now?: () => number;
  /** Are big effects switched off right now? Re-read on every call. Defaults to prefs.effectsReduced. */
  reduced?: () => boolean;
  /** Called when the preference may have changed. Defaults to prefs.subscribe. */
  subscribePrefs?: (cb: () => void) => () => void;
  /** Where the shake variables are written. */
  shakeTarget?: ShakeTarget;
  rng?: Rng;
  createCanvas?: CanvasFactory;
  /** Pool size (defaults to MAX_PARTICLES). */
  maxParticles?: number;
}

export interface FxDebug {
  alive: number;
  rings: number;
  pending: number;
  max: number;
  /** Is the render loop scheduled? False when idle. */
  running: boolean;
  shaking: boolean;
  reduced: boolean;
  frames: number;
}

export interface FxEngine extends FxController {
  /** Re-measure the viewport (also done automatically on resize). */
  resize(): void;
  /** Stop everything and release listeners. */
  destroy(): void;
  debug(): FxDebug;
  /** The underlying system, for tests and the lab. */
  readonly particles: ParticleSystem;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function createFxEngine(deps: FxEngineDeps): FxEngine {
  const win: WindowLike | null = deps.win !== undefined ? deps.win : typeof window !== "undefined" ? (window as unknown as WindowLike) : null;
  const doc: DocumentLike | null = deps.doc !== undefined ? deps.doc : typeof document !== "undefined" ? (document as unknown as DocumentLike) : null;
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  const now = deps.now ?? (() => performance.now());
  const reduced = deps.reduced ?? (() => prefs.effectsReduced());
  const subscribePrefs = deps.subscribePrefs ?? ((cb) => prefs.subscribe(cb));

  const particles = new ParticleSystem({ max: deps.maxParticles ?? MAX_PARTICLES, rng: deps.rng, createCanvas: deps.createCanvas });
  const shaker: Shake = createShake({ target: deps.shakeTarget, raf, caf, now });
  const canvas = deps.canvas;
  let ctx: CanvasRenderingContext2D | null = null;

  let destroyed = false;
  let rafId = 0;
  let last = 0;
  let frames = 0;

  /* -------------------------------------------------------------------------------- canvas */

  let dpr = 1;
  let sized = { w: 0, h: 0, dpr: 0 };
  let sizeDirty = true;

  const measure = () => {
    const w = Math.max(1, Math.round(win?.innerWidth ?? 1));
    const h = Math.max(1, Math.round(win?.innerHeight ?? 1));
    const ratio = Math.min(2, Math.max(1, win?.devicePixelRatio ?? 1));
    return { w, h, dpr: ratio };
  };

  /** Size the backing store lazily — an idle page never pays for a full-screen canvas. */
  const ensureSize = () => {
    if (!canvas || !sizeDirty) return;
    sizeDirty = false;
    const m = measure();
    if (m.w === sized.w && m.h === sized.h && m.dpr === sized.dpr) return;
    sized = m;
    dpr = m.dpr;
    canvas.width = Math.round(m.w * m.dpr);
    canvas.height = Math.round(m.h * m.dpr);
  };

  const render = () => {
    if (!canvas) return;
    ctx ??= canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.draw(ctx, dpr);
  };

  const hideCanvas = () => {
    if (!canvas) return;
    ctx ??= canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.style.visibility = "hidden";
  };

  /* ---------------------------------------------------------------------------------- loop */

  const frame = (ts: number) => {
    rafId = 0;
    if (destroyed) return;
    const t = Number.isFinite(ts) ? ts : now();
    const dt = Math.min(MAX_DT, Math.max(0, (t - last) / 1000));
    last = t;
    frames++;
    if (reduced()) particles.clear();
    particles.step(dt);
    render();
    if (particles.active) rafId = raf(frame);
    else hideCanvas();
  };

  const start = () => {
    if (rafId || destroyed || doc?.hidden) return;
    if (canvas) {
      ensureSize();
      canvas.style.visibility = "visible";
    }
    last = now();
    rafId = raf(frame);
  };

  const stopLoop = () => {
    if (rafId) caf(rafId);
    rafId = 0;
  };

  /* ---------------------------------------------------------------------------- flash + vignette */

  let flashAnim: { cancel(): void } | null = null;
  let vigLevel = 0;
  let vigColor: Rgba = parseColor(DEFAULT_VIGNETTE_COLOR);
  let vigTimer: ReturnType<typeof setTimeout> | undefined;

  const applyVignette = () => {
    const el = deps.vignette;
    if (!el) return;
    const isReduced = reduced();
    const level = Math.min(vigLevel, isReduced ? REDUCED_VIGNETTE_CAP : 1);
    const ease = isReduced ? REDUCED_VIGNETTE_EASE_MS : VIGNETTE_EASE_MS;
    el.style.transition = `opacity ${ease}ms ease-out`;
    clearTimeout(vigTimer);
    if (level <= 0.001) {
      el.style.opacity = "0";
      // drop the layer once it has faded, so an idle page keeps no full-screen GPU surface
      vigTimer = setTimeout(() => {
        el.style.visibility = "hidden";
        if (el.style.willChange !== undefined) el.style.willChange = "auto";
      }, ease + 60);
      return;
    }
    if (el.style.visibility !== "visible") {
      el.style.visibility = "visible";
      void el.offsetWidth; // commit the starting state so the fade-in actually runs
    }
    el.style.willChange = "opacity";
    const c = vigColor;
    el.style.background = `radial-gradient(ellipse at center, ${rgbaCss(c, 0)} 45%, ${rgbaCss({ ...c, a: 1 }, 1)} 100%)`;
    el.style.opacity = String(Math.round(level * 0.85 * 1000) / 1000);
  };

  /* ---------------------------------------------------------------------------- lifecycle hooks */

  const markDirty = () => {
    sizeDirty = true;
    if (rafId) ensureSize();
  };
  const onVisibility = () => {
    if (!doc?.hidden) return;
    // nobody is watching: drop everything rather than simulate it
    stopLoop();
    particles.clear();
    shaker.cancel();
    hideCanvas();
  };
  const onPrefs = () => {
    if (reduced()) {
      particles.clear();
      shaker.cancel();
      flashAnim?.cancel();
    }
    applyVignette();
  };

  win?.addEventListener("resize", markDirty);
  win?.addEventListener("orientationchange", markDirty);
  win?.visualViewport?.addEventListener("resize", markDirty);
  doc?.addEventListener("visibilitychange", onVisibility);
  const unsubscribePrefs = subscribePrefs(onPrefs);

  /* ------------------------------------------------------------------------------ controller */

  const api: FxEngine = {
    particles,

    shake(intensity: number, durationMs: number = DEFAULT_DURATION_MS) {
      if (destroyed || reduced() || !(intensity > 0)) return;
      shaker.add(clamp01(intensity), durationMs);
    },

    flash(color: string, peak: number = DEFAULT_FLASH_PEAK, durationMs: number = DEFAULT_FLASH_MS) {
      const el = deps.flash;
      if (destroyed || reduced() || !el || typeof el.animate !== "function") return;
      const p = clamp01(peak);
      if (p <= 0) return;
      const c = parseColor(color);
      // a little lighter in the middle, so the flash reads as light rather than a flat tint
      el.style.background = `radial-gradient(ellipse at 50% 50%, ${rgbaCss(c, 0.55)} 0%, ${rgbaCss(c, 0.9)} 60%, ${rgbaCss(c, 1)} 100%)`;
      flashAnim?.cancel();
      flashAnim = el.animate(
        [
          { opacity: 0, easing: "cubic-bezier(.2,.8,.3,1)" },
          { opacity: p, offset: 0.16, easing: "cubic-bezier(.25,.6,.4,1)" },
          { opacity: 0 },
        ],
        { duration: Math.max(60, durationMs) },
      );
    },

    burst(kind: BurstKind, at: Point, opts?: BurstOptions) {
      if (destroyed || reduced() || doc?.hidden) return;
      if (particles.burst(kind, at, opts) > 0) start();
    },

    ring(at: Point, opts?: RingOptions) {
      if (destroyed || reduced() || doc?.hidden) return;
      particles.ring(at, opts);
      start();
    },

    vignette(level: number, color?: string) {
      if (destroyed) return;
      vigLevel = Number.isFinite(level) ? clamp01(level) : 0;
      if (color !== undefined) vigColor = parseColor(color);
      applyVignette();
    },

    resize() {
      sizeDirty = true;
      ensureSize();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      particles.clear();
      shaker.cancel();
      flashAnim?.cancel();
      flashAnim = null;
      clearTimeout(vigTimer);
      if (deps.vignette) {
        deps.vignette.style.opacity = "0";
        deps.vignette.style.visibility = "hidden";
      }
      hideCanvas();
      win?.removeEventListener("resize", markDirty);
      win?.removeEventListener("orientationchange", markDirty);
      win?.visualViewport?.removeEventListener("resize", markDirty);
      doc?.removeEventListener("visibilitychange", onVisibility);
      unsubscribePrefs();
    },

    debug(): FxDebug {
      return {
        alive: particles.alive,
        rings: particles.ringCount,
        pending: particles.pendingCount,
        max: particles.max,
        running: rafId !== 0,
        shaking: shaker.active,
        reduced: reduced(),
        frames,
      };
    },
  };

  return api;
}
