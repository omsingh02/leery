import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFxEngine, DEFAULT_VIGNETTE_COLOR, MAX_DT, REDUCED_VIGNETTE_CAP, type FxEngineDeps } from "@/lib/fx/engine";
import { parseColor } from "@/lib/fx/color";
import { prefs } from "@/lib/prefs";
import { mulberry32 } from "@/lib/fx/rng";

type Emitter = Map<string, Set<() => void>>;
const on = (m: Emitter) => (type: string, cb: () => void) => void (m.get(type) ?? m.set(type, new Set()).get(type)!).add(cb);
const off = (m: Emitter) => (type: string, cb: () => void) => void m.get(type)?.delete(cb);
const fire = (m: Emitter, type: string) => m.get(type)?.forEach((cb) => cb());

function build(over: Partial<FxEngineDeps> = {}) {
  let t = 0;
  let nextId = 0;
  const queue = new Map<number, (ts: number) => void>();
  const caf = vi.fn((id: number) => void queue.delete(id));
  const flags = { reduced: false };
  const prefCallbacks = new Set<() => void>();
  const unsubscribe = vi.fn();
  const winEvents: Emitter = new Map();
  const docEvents: Emitter = new Map();
  const win = {
    innerWidth: 400,
    innerHeight: 800,
    devicePixelRatio: 3,
    addEventListener: vi.fn(on(winEvents)),
    removeEventListener: vi.fn(off(winEvents)),
    visualViewport: null,
  };
  const doc = { hidden: false, addEventListener: vi.fn(on(docEvents)), removeEventListener: vi.fn(off(docEvents)) };

  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    strokeStyle: "",
    lineWidth: 0,
  };
  const canvas = { width: 0, height: 0, style: { visibility: "hidden" }, getContext: vi.fn(() => ctx as unknown as CanvasRenderingContext2D) };

  const flashAnims: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const flash = {
    style: { opacity: "0", visibility: "", background: "", transition: "" },
    animate: vi.fn((_kf: Keyframe[], _opts: KeyframeAnimationOptions) => {
      const a = { cancel: vi.fn() };
      flashAnims.push(a);
      return a;
    }),
  };
  const vignette = { style: { opacity: "0", visibility: "hidden", background: "", transition: "", willChange: "" }, offsetWidth: 0 };
  const shakeVars: Record<string, string> = {};
  const shakeTarget = { style: { setProperty: vi.fn((n: string, v: string) => void (shakeVars[n] = v)) } };

  const engine = createFxEngine({
    canvas,
    flash,
    vignette,
    win,
    doc,
    raf: (cb) => {
      queue.set(++nextId, cb);
      return nextId;
    },
    caf,
    now: () => t,
    reduced: () => flags.reduced,
    subscribePrefs: (cb) => {
      prefCallbacks.add(cb);
      return () => {
        prefCallbacks.delete(cb);
        unsubscribe();
      };
    },
    shakeTarget,
    rng: mulberry32(1),
    createCanvas: () => null,
    ...over,
  });

  /** Advance to `ms` and run the frame callbacks that were waiting. */
  const frame = (ms: number) => {
    t = ms;
    const waiting = [...queue.values()];
    queue.clear();
    waiting.forEach((cb) => cb(t));
  };
  /** Run frames every 16 ms until nothing is scheduled (or give up). */
  const settle = (from = 0, limit = 400) => {
    let ms = from;
    for (let i = 0; i < limit && queue.size; i++) frame((ms += 16));
    return ms;
  };
  return { engine, frame, settle, queue, caf, flags, prefCallbacks, unsubscribe, win, doc, winEvents, docEvents, ctx, canvas, flash, flashAnims, vignette, shakeVars, shakeTarget, setNow: (ms: number) => void (t = ms) };
}

const PT = { x: 120, y: 340 };

describe("render loop", () => {
  it("is completely idle until something is emitted", () => {
    const h = build();
    expect(h.queue.size).toBe(0);
    expect(h.canvas.width).toBe(0); // backing store is created lazily
    expect(h.engine.debug()).toMatchObject({ running: false, alive: 0, rings: 0, pending: 0, shaking: false, frames: 0 });
    expect(h.win.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(h.win.addEventListener).toHaveBeenCalledWith("orientationchange", expect.any(Function));
    expect(h.doc.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("starts one rAF loop for the first burst, sizes the canvas with the DPR clamped to 1.5, and shows it", () => {
    const h = build();
    h.engine.burst("sparks", PT);
    expect(h.queue.size).toBe(1);
    expect(h.canvas.width).toBe(600); // 400 css px × min(1.5, 3)
    expect(h.canvas.height).toBe(1200);
    expect(h.canvas.style.visibility).toBe("visible");
    h.engine.burst("dust", PT);
    h.engine.ring(PT);
    expect(h.queue.size).toBe(1); // still just the one loop
    expect(h.engine.debug().running).toBe(true);
    expect(h.engine.debug().alive).toBeGreaterThan(0);
  });

  it("a ring alone also runs the loop", () => {
    const h = build();
    h.engine.ring(PT, { duration: 200 });
    expect(h.queue.size).toBe(1);
    expect(h.engine.debug().rings).toBe(1);
  });

  it("clears and redraws every frame, then stops and hides the canvas when everything has died", () => {
    const h = build();
    h.engine.burst("sparks", PT);
    h.frame(16);
    expect(h.ctx.clearRect).toHaveBeenCalledWith(0, 0, 600, 1200);
    expect(h.ctx.setTransform).toHaveBeenCalled();
    h.settle(16);
    expect(h.queue.size).toBe(0);
    expect(h.canvas.style.visibility).toBe("hidden");
    expect(h.engine.debug()).toMatchObject({ running: false, alive: 0 });
    expect(h.engine.debug().frames).toBeGreaterThan(10);
  });

  it("caps the step so a stalled frame can't teleport particles", () => {
    const h = build();
    h.engine.burst("sparks", PT, { count: 10 });
    h.frame(5000); // the tab stalled for five seconds
    const ages = h.engine.particles.snapshot().map((p) => p.age);
    expect(ages.length).toBe(10); // nothing expired
    for (const a of ages) expect(a).toBeLessThanOrEqual(MAX_DT + 1e-6);
  });

  it("re-measures on resize: immediately while running, lazily while idle", () => {
    const h = build();
    h.engine.burst("dust", PT);
    h.win.innerWidth = 500;
    fire(h.winEvents, "resize");
    expect(h.canvas.width).toBe(750);
    h.settle();
    h.win.innerWidth = 300;
    fire(h.winEvents, "orientationchange");
    expect(h.canvas.width).toBe(750); // idle: untouched
    h.engine.burst("dust", PT);
    expect(h.canvas.width).toBe(450);
  });

  it("an explicit resize() applies at once", () => {
    const h = build();
    h.win.innerHeight = 600;
    h.engine.resize();
    expect(h.canvas.height).toBe(900);
  });
});

describe("frame governor", () => {
  it("a device that can't keep up gets a smaller canvas, then fewer particles, then half-rate repaints", () => {
    const h = build();
    h.engine.burst("confetti", PT, { count: 60 });
    expect(h.canvas.width).toBe(600); // full quality: 1.5×
    h.frame(16);
    const full = h.engine.particles.snapshot().length;
    expect(full).toBe(60);
    // a long run of 40 ms frames (25 fps)
    let ts = 16;
    for (let i = 0; i < 120 && h.engine.debug().quality.level < 2; i++) {
      h.engine.burst("sparks", PT, { count: 1 }); // keep the loop alive
      ts += 40;
      h.frame(ts);
    }
    expect(h.engine.debug().quality.level).toBeGreaterThan(0);
    expect(h.canvas.width).toBe(400); // dropped to 1×
    const before = h.ctx.clearRect.mock.calls.length;
    h.engine.particles.clear();
    // fewer particles per burst from now on
    h.engine.burst("confetti", PT, { count: 60 });
    h.frame((ts += 40));
    expect(h.engine.particles.snapshot().length).toBeLessThan(60);
    expect(h.ctx.clearRect.mock.calls.length).toBeGreaterThanOrEqual(before);
  });
});

describe("reduced effects", () => {
  it("makes shake, flash, burst and ring no-ops — and re-reads the preference on every call", () => {
    const h = build();
    h.flags.reduced = true;
    h.engine.burst("confetti", PT);
    h.engine.ring(PT);
    h.engine.shake(1, 400);
    h.engine.flash("#ff0000", 0.5);
    expect(h.queue.size).toBe(0);
    expect(h.engine.debug().alive).toBe(0);
    expect(h.engine.debug().rings).toBe(0);
    expect(h.flash.animate).not.toHaveBeenCalled();
    expect(h.shakeTarget.style.setProperty).not.toHaveBeenCalled();

    h.flags.reduced = false; // the very next call sees it
    h.engine.burst("sparks", PT);
    h.engine.shake(0.5);
    h.engine.flash("#ff0000", 0.5);
    expect(h.engine.debug().alive).toBeGreaterThan(0);
    expect(h.queue.size).toBe(2); // particle loop + shake loop
    expect(h.flash.animate).toHaveBeenCalledTimes(1);
  });

  it("drops live particles as soon as the preference flips", () => {
    const h = build();
    h.engine.burst("confetti", PT);
    h.engine.shake(1, 500);
    expect(h.engine.debug().alive).toBeGreaterThan(0);
    h.flags.reduced = true;
    h.prefCallbacks.forEach((cb) => cb()); // what prefs.subscribe does
    expect(h.engine.debug().alive).toBe(0);
    expect(h.engine.debug().shaking).toBe(false);
    expect(h.flashAnims.length).toBe(0);
    h.settle();
    expect(h.canvas.style.visibility).toBe("hidden");
  });

  it("stops simulating on the next frame even without the callback", () => {
    const h = build();
    h.engine.burst("confetti", PT);
    h.flags.reduced = true;
    h.frame(16);
    expect(h.engine.debug().alive).toBe(0);
    expect(h.queue.size).toBe(0);
  });
});

describe("shake", () => {
  it("drives the CSS variables through the shake loop", () => {
    const h = build();
    h.engine.shake(0.8, 300);
    expect(h.engine.debug().shaking).toBe(true);
    h.setNow(0);
    h.frame(16);
    expect(h.shakeVars["--fx-sx"]).toMatch(/px$/);
    h.settle(16);
    expect(h.shakeVars["--fx-sx"]).toBe("0.00px");
    expect(h.engine.debug().shaking).toBe(false);
  });

  it("ignores zero intensity", () => {
    const h = build();
    h.engine.shake(0);
    h.engine.shake(-1);
    expect(h.queue.size).toBe(0);
  });
});

describe("flash", () => {
  it("animates opacity 0 → peak → 0 in the requested colour", () => {
    const h = build();
    h.engine.flash("#ff0000", 0.4, 300);
    expect(h.flash.animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = h.flash.animate.mock.calls[0];
    expect(keyframes.map((k) => k.opacity)).toEqual([0, 0.4, 0]);
    expect(keyframes[1].offset).toBe(0.16);
    expect(options.duration).toBe(300);
    expect(h.flash.style.background).toContain("rgba(255, 0, 0");
  });

  it("uses sensible defaults, clamps the peak and floors the duration", () => {
    const h = build();
    h.engine.flash("hsl(166 84% 50%)");
    const [kf, o] = h.flash.animate.mock.calls[0];
    expect(kf[1].opacity).toBe(0.35);
    expect(o.duration).toBe(220);
    h.engine.flash("#fff", 9, 5);
    const [kf2, o2] = h.flash.animate.mock.calls[1];
    expect(kf2[1].opacity).toBe(1);
    expect(o2.duration).toBe(60);
    h.engine.flash("#fff", 0);
    expect(h.flash.animate).toHaveBeenCalledTimes(2);
  });

  it("a new flash replaces the one still running", () => {
    const h = build();
    h.engine.flash("#f00");
    h.engine.flash("#0f0");
    expect(h.flashAnims[0].cancel).toHaveBeenCalledTimes(1);
    expect(h.flashAnims[1].cancel).not.toHaveBeenCalled();
  });

  it("does nothing when the layer or the Web Animations API is missing", () => {
    const noLayer = build({ flash: null });
    expect(() => noLayer.engine.flash("#f00")).not.toThrow();
    const noWaapi = build({ flash: { style: { opacity: "0", visibility: "", background: "", transition: "" } } });
    expect(() => noWaapi.engine.flash("#f00")).not.toThrow();
  });
});

describe("vignette", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fades in to level × 0.85 with an edge gradient and keeps the default tense red", () => {
    const h = build();
    h.engine.vignette(0.6);
    expect(h.vignette.style.visibility).toBe("visible");
    expect(parseFloat(h.vignette.style.opacity)).toBeCloseTo(0.51, 3);
    expect(h.vignette.style.transition).toBe("opacity 250ms ease-out");
    expect(h.vignette.style.background).toContain("radial-gradient(ellipse at center");
    expect(h.vignette.style.background).toContain("45%");
    expect(DEFAULT_VIGNETTE_COLOR).toBe("hsl(348 90% 32%)");
    const c = parseColor(DEFAULT_VIGNETTE_COLOR);
    expect(h.vignette.style.background).toContain(`rgba(${c.r}, ${c.g}, ${c.b}, 0)`); // transparent centre, same hue
    expect(h.vignette.style.background).toContain(`rgba(${c.r}, ${c.g}, ${c.b}, 1)`);
  });

  it("remembers the colour between calls and accepts a new one", () => {
    const h = build();
    h.engine.vignette(0.5, "#8b5cf6");
    h.engine.vignette(0.7); // no colour: keeps violet
    expect(h.vignette.style.background).toContain("rgba(139, 92, 246, 1)");
    h.engine.vignette(0.7, "hsl(44 97% 58%)");
    expect(h.vignette.style.background).toContain("rgba(252, 196, 44, 1)");
  });

  it("level 0 fades out and then releases the layer", () => {
    const h = build();
    h.engine.vignette(1);
    expect(h.vignette.style.opacity).toBe("0.85");
    h.engine.vignette(0);
    expect(h.vignette.style.opacity).toBe("0");
    expect(h.vignette.style.visibility).toBe("visible"); // still fading
    vi.advanceTimersByTime(400);
    expect(h.vignette.style.visibility).toBe("hidden");
  });

  it("raising it again before the fade-out ends cancels the release", () => {
    const h = build();
    h.engine.vignette(1);
    h.engine.vignette(0);
    vi.advanceTimersByTime(100);
    h.engine.vignette(0.5);
    vi.advanceTimersByTime(1000);
    expect(h.vignette.style.visibility).toBe("visible");
    expect(parseFloat(h.vignette.style.opacity)).toBeCloseTo(0.425, 3);
  });

  it("clamps the level and shrugs off NaN", () => {
    const h = build();
    h.engine.vignette(5);
    expect(h.vignette.style.opacity).toBe("0.85");
    h.engine.vignette(Number.NaN);
    expect(h.vignette.style.opacity).toBe("0");
    h.engine.vignette(-3);
    expect(h.vignette.style.opacity).toBe("0");
  });

  it("is capped at 0.35 and eased slowly when effects are reduced, and re-applies on a preference change", () => {
    const h = build();
    h.engine.vignette(1);
    expect(h.vignette.style.opacity).toBe("0.85");
    h.flags.reduced = true;
    h.prefCallbacks.forEach((cb) => cb());
    expect(parseFloat(h.vignette.style.opacity)).toBeCloseTo(REDUCED_VIGNETTE_CAP * 0.85, 2);
    expect(h.vignette.style.transition).toBe("opacity 700ms ease-out");
    h.engine.vignette(0.9); // pulses can't punch through the cap either
    expect(parseFloat(h.vignette.style.opacity)).toBeCloseTo(REDUCED_VIGNETTE_CAP * 0.85, 2);
    h.flags.reduced = false;
    h.prefCallbacks.forEach((cb) => cb());
    expect(parseFloat(h.vignette.style.opacity)).toBeCloseTo(0.765, 3);
    expect(h.vignette.style.transition).toBe("opacity 250ms ease-out");
  });
});

describe("page visibility and teardown", () => {
  it("does nothing while the document is hidden, and drops everything when it becomes hidden", () => {
    const h = build();
    h.engine.burst("confetti", PT);
    h.engine.shake(1, 500);
    expect(h.queue.size).toBe(2);
    h.doc.hidden = true;
    fire(h.docEvents, "visibilitychange");
    expect(h.engine.debug().alive).toBe(0);
    expect(h.engine.debug().shaking).toBe(false);
    expect(h.queue.size).toBe(0);
    expect(h.canvas.style.visibility).toBe("hidden");
    h.engine.burst("sparks", PT); // hidden → ignored
    h.engine.ring(PT);
    expect(h.queue.size).toBe(0);
    h.doc.hidden = false;
    fire(h.docEvents, "visibilitychange");
    h.engine.burst("sparks", PT);
    expect(h.queue.size).toBe(1);
  });

  it("destroy() stops everything, releases listeners and turns later calls into no-ops", () => {
    vi.useFakeTimers();
    const h = build();
    h.engine.burst("confetti", PT);
    h.engine.vignette(0.8);
    h.engine.flash("#f00");
    h.engine.destroy();
    expect(h.queue.size).toBe(0);
    expect(h.caf).toHaveBeenCalled();
    expect(h.engine.debug().alive).toBe(0);
    expect(h.flashAnims[0].cancel).toHaveBeenCalled();
    expect(h.vignette.style.visibility).toBe("hidden");
    expect(h.vignette.style.opacity).toBe("0");
    expect(h.win.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(h.win.removeEventListener).toHaveBeenCalledWith("orientationchange", expect.any(Function));
    expect(h.doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);

    h.engine.burst("sparks", PT);
    h.engine.ring(PT);
    h.engine.shake(1);
    h.engine.flash("#f00");
    h.engine.vignette(1);
    expect(h.queue.size).toBe(0);
    expect(h.flash.animate).toHaveBeenCalledTimes(1);
    expect(h.vignette.style.opacity).toBe("0");
    h.engine.destroy(); // idempotent
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("works with no layers at all (a provider that failed to mount)", () => {
    const h = build({ canvas: null, flash: null, vignette: null });
    expect(() => {
      h.engine.burst("sparks", PT);
      h.settle();
      h.engine.vignette(1);
      h.engine.flash("#f00");
      h.engine.destroy();
    }).not.toThrow();
  });
});

describe("with the real preferences", () => {
  afterEach(() => prefs.set({ effects: "auto" }));

  it("follows prefs.effects on every call", () => {
    const real = build({ reduced: undefined, subscribePrefs: undefined });
    prefs.set({ effects: "reduced" });
    real.engine.burst("sparks", PT);
    real.engine.shake(1);
    expect(real.queue.size).toBe(0);
    expect(real.engine.debug().reduced).toBe(true);
    prefs.set({ effects: "full" });
    real.engine.burst("sparks", PT);
    expect(real.queue.size).toBe(1);
    expect(real.engine.debug().reduced).toBe(false);
    real.engine.destroy();
  });

  it("reacts to the preference changing while particles are alive", () => {
    prefs.set({ effects: "full" });
    const real = build({ reduced: undefined, subscribePrefs: undefined });
    real.engine.burst("confetti", PT);
    expect(real.engine.debug().alive).toBeGreaterThan(0);
    prefs.set({ effects: "reduced" });
    expect(real.engine.debug().alive).toBe(0);
    real.engine.destroy();
  });
});
