import { describe, expect, it, vi } from "vitest";
import type { BurstKind } from "@/lib/feel/contract";
import { parseColor } from "@/lib/fx/color";
import {
  KIND_SPECS,
  MAX_PARTICLES,
  MAX_RINGS,
  ParticleSystem,
  ringShape,
  speedScale,
  type CanvasLike,
  type Ctx2D,
} from "@/lib/fx/particles";
import { mulberry32 } from "@/lib/fx/rng";

const KINDS = Object.keys(KIND_SPECS) as BurstKind[];
const ORIGIN = { x: 100, y: 200 };
const EPS = 1e-3; // typed arrays are float32

const make = (seed = 1, max?: number) => new ParticleSystem({ max, rng: mulberry32(seed), createCanvas: () => null });
const speedOf = (p: { vx: number; vy: number }) => Math.hypot(p.vx, p.vy);

/** A 2D context that swallows everything — enough to build sprites without a canvas. */
function sinkCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, prop: string) => {
      if (prop in t) return t[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      return () => undefined;
    },
    set: (t, prop: string, v) => {
      t[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
const fakeCanvas = (): CanvasLike => ({ width: 8, height: 8, getContext: () => sinkCtx() });

describe("pool", () => {
  it("never holds more than its budget and reports the live count", () => {
    const s = make(1);
    for (let i = 0; i < 40; i++) s.burst("confetti", ORIGIN, { count: 160 });
    expect(s.alive).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(s.alive).toBe(s.snapshot().length);
    expect(s.max).toBe(MAX_PARTICLES);
  });

  it("recycles the oldest particles first, and a single burst can't wipe out the pool", () => {
    const s = make(2, 50);
    s.burst("sparks", { x: 0, y: 0 }, { count: 30 }); // A: oldest
    s.burst("sparks", { x: 1000, y: 0 }, { count: 30 }); // B: fills the pool, recycling 10 of A
    expect(s.alive).toBe(50);
    const emitted = s.burst("sparks", { x: 2000, y: 0 }, { count: 30 }); // C: pool full → at most 35% may be recycled
    expect(emitted).toBe(17);
    const at = (x: number) => s.snapshot().filter((p) => p.x === x).length;
    expect(at(2000)).toBe(17);
    expect(at(1000)).toBe(30); // untouched
    expect(at(0)).toBe(3); // the oldest were the ones overwritten
    expect(s.alive).toBe(50);
  });

  it("clamps one burst to the kind's cap and ignores nonsense counts", () => {
    const s = make(3);
    expect(s.burst("sparks", ORIGIN, { count: 5000 })).toBe(KIND_SPECS.sparks.maxPerBurst);
    expect(s.burst("dust", ORIGIN, { count: 0 })).toBe(0);
    expect(s.burst("dust", ORIGIN, { count: -4 })).toBe(0);
    expect(s.burst("dust", ORIGIN, { count: Number.NaN })).toBe(KIND_SPECS.dust.count);
  });

  it("never emits more than the pool holds, so a burst can't overwrite its own start", () => {
    const s = make(8, 50);
    expect(s.burst("sparks", ORIGIN, { count: 80 })).toBe(50);
    expect(s.alive).toBe(50);
  });

  it("a delayed burst keeps the options it was given, even if the caller reuses the object", () => {
    const s = make(9);
    const opts = { count: 4, delay: 0.2, color: "#ff0000" };
    s.burst("sparks", ORIGIN, opts);
    opts.color = "#0000ff";
    opts.count = 99;
    s.step(0.3);
    expect(s.alive).toBe(4);
    expect(new Set(s.snapshot().map((p) => p.color.join()))).toEqual(new Set(["255,0,0"]));
  });

  it("uses the kind's default count when none is given", () => {
    for (const k of KINDS) expect(make(4).burst(k, ORIGIN)).toBe(KIND_SPECS[k].count);
  });

  it("ignores non-finite positions and unknown kinds", () => {
    const s = make(5);
    expect(s.burst("sparks", { x: Number.NaN, y: 0 })).toBe(0);
    expect(s.burst("sparks", { x: 0, y: Number.POSITIVE_INFINITY })).toBe(0);
    expect(s.burst("nope" as BurstKind, ORIGIN)).toBe(0);
    s.ring({ x: Number.NaN, y: 0 });
    expect(s.active).toBe(false);
  });

  it("clear() empties live particles, pending bursts and rings", () => {
    const s = make(6);
    s.burst("dust", ORIGIN);
    s.burst("dust", ORIGIN, { delay: 1 });
    s.ring(ORIGIN);
    expect(s.active).toBe(true);
    s.clear();
    expect(s.alive).toBe(0);
    expect(s.pendingCount).toBe(0);
    expect(s.ringCount).toBe(0);
    expect(s.active).toBe(false);
  });
});

describe("determinism", () => {
  const run = (seed: number) => {
    const s = make(seed);
    s.burst("confetti", ORIGIN, { count: 40 });
    s.burst("embers", ORIGIN, { count: 10, delay: 0.1 });
    for (let i = 0; i < 30; i++) s.step(1 / 60);
    return JSON.stringify(s.snapshot());
  };

  it("the same seed gives the same simulation", () => {
    expect(run(7)).toBe(run(7));
  });

  it("a different seed gives a different one", () => {
    expect(run(7)).not.toBe(run(8));
  });
});

describe("launch parameters per kind", () => {
  it.each(KINDS)("%s starts inside its documented ranges", (kind) => {
    const spec = KIND_SPECS[kind];
    const scale = speedScale(0.55);
    for (let seed = 1; seed <= 12; seed++) {
      const s = make(seed);
      s.burst(kind, ORIGIN, { count: spec.maxPerBurst });
      for (const p of s.snapshot()) {
        expect(speedOf(p)).toBeGreaterThanOrEqual(spec.speed[0] * scale - EPS);
        expect(speedOf(p)).toBeLessThanOrEqual(spec.speed[1] * scale + EPS);
        expect(p.life).toBeGreaterThanOrEqual(spec.life[0] - EPS);
        expect(p.life).toBeLessThanOrEqual(spec.life[1] + EPS);
        expect(p.size).toBeGreaterThanOrEqual(spec.size[0] - EPS);
        expect(p.size).toBeLessThanOrEqual(spec.size[1] + EPS);
        expect(p.alpha).toBeGreaterThanOrEqual(spec.alpha[0] - EPS);
        expect(p.alpha).toBeLessThanOrEqual(spec.alpha[1] + EPS);
        expect(p.age).toBe(0);
        const reach = kind === "glints" ? 10 + 46 * 0.55 : spec.jitter;
        expect(Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y)).toBeLessThanOrEqual(reach + EPS);
      }
    }
  });

  it("keeps every particle small and quiet", () => {
    // the look rule: sparks are hairlines, puffs and glints stay small, nothing is a blob of colour
    expect(KIND_SPECS.sparks.size[1]).toBeLessThanOrEqual(4);
    expect(KIND_SPECS.dust.size[1]).toBeLessThanOrEqual(18);
    expect(KIND_SPECS.glints.size[1]).toBeLessThanOrEqual(14);
    expect(KIND_SPECS.dust.alpha[1]).toBeLessThanOrEqual(0.35);
    expect(KIND_SPECS.smoke.alpha[1]).toBeLessThanOrEqual(0.3);
  });

  it("scales speed with power: ×0.4 at 0, ×1.4 at 1", () => {
    const at = (power: number) => {
      const s = make(11);
      s.burst("dust", ORIGIN, { count: 20, power });
      return s.snapshot().map(speedOf);
    };
    const lo = at(0);
    const hi = at(1);
    expect(speedScale(0)).toBeCloseTo(0.4);
    expect(speedScale(1)).toBeCloseTo(1.4);
    lo.forEach((v, i) => expect(hi[i] / v).toBeCloseTo(3.5, 2));
  });

  it("points the burst along `angle` within `spread`", () => {
    const s = make(12);
    s.burst("sparks", ORIGIN, { count: 80, angle: -90, spread: 0 });
    for (const p of s.snapshot()) {
      expect(p.vx).toBeCloseTo(0, 2);
      expect(p.vy).toBeLessThan(0); // straight up
    }
    const cone = make(13);
    cone.burst("embers", ORIGIN, { count: 60, angle: 0, spread: 40 });
    for (const p of cone.snapshot()) {
      const deg = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
      expect(Math.abs(deg)).toBeLessThanOrEqual(20 + 0.01);
    }
  });

  it("takes one colour, a list, or the kind's palette — and multiplies the colour's own alpha", () => {
    const one = make(14);
    one.burst("sparks", ORIGIN, { count: 20, color: "#ff0000" });
    expect(new Set(one.snapshot().map((p) => p.color.join()))).toEqual(new Set(["255,0,0"]));

    const list = make(15);
    list.burst("sparks", ORIGIN, { count: 60, color: ["#ff0000", "#0000ff"] });
    expect(new Set(list.snapshot().map((p) => p.color.join()))).toEqual(new Set(["255,0,0", "0,0,255"]));

    const dflt = make(16);
    dflt.burst("confetti", ORIGIN, { count: 160 });
    expect(new Set(dflt.snapshot().map((p) => p.color.join())).size).toBeGreaterThanOrEqual(4);

    const faded = make(17);
    faded.burst("sparks", ORIGIN, { count: 10, color: "hsl(0 100% 50% / 0.5)" });
    for (const p of faded.snapshot()) expect(p.alpha).toBeLessThanOrEqual(0.5 + EPS);
  });
});

describe("simulation", () => {
  it("particles expire after their life and the system goes idle", () => {
    const s = make(20);
    s.burst("sparks", ORIGIN);
    expect(s.active).toBe(true);
    for (let i = 0; i < 60; i++) s.step(1 / 30);
    expect(s.alive).toBe(0);
    expect(s.active).toBe(false);
  });

  it("applies gravity and drag", () => {
    const sparks = make(21);
    sparks.burst("sparks", ORIGIN, { count: 10, angle: 0, spread: 0 });
    sparks.step(0.1);
    for (const p of sparks.snapshot()) {
      expect(p.vy).toBeGreaterThan(0); // gravity pulls down
      expect(p.y).toBeGreaterThan(ORIGIN.y);
    }
    const dust = make(22);
    dust.burst("dust", { x: 0, y: 0 }, { count: 10, angle: 0, spread: 0 });
    const before = dust.snapshot().map(speedOf);
    dust.step(0.1);
    dust.snapshot().forEach((p, i) => expect(speedOf(p)).toBeLessThan(before[i]));
  });

  it("embers rise and confetti falls", () => {
    const embers = make(23);
    embers.burst("embers", ORIGIN, { count: 10, angle: 0, spread: 0, power: 0 });
    for (let i = 0; i < 30; i++) embers.step(1 / 60);
    for (const p of embers.snapshot()) expect(p.y).toBeLessThan(ORIGIN.y);
    const confetti = make(24);
    confetti.burst("confetti", ORIGIN, { count: 20, angle: 0, spread: 0, power: 0 });
    for (let i = 0; i < 90; i++) confetti.step(1 / 60);
    for (const p of confetti.snapshot()) expect(p.y).toBeGreaterThan(ORIGIN.y);
  });

  it("ignores zero, negative and NaN time steps", () => {
    const s = make(25);
    s.burst("dust", ORIGIN);
    const before = JSON.stringify(s.snapshot());
    s.step(0);
    s.step(-1);
    s.step(Number.NaN);
    expect(JSON.stringify(s.snapshot())).toBe(before);
  });

  it("a long step lands the leftover time on delayed bursts", () => {
    const s = make(26);
    expect(s.burst("sparks", ORIGIN, { delay: 0.5, count: 5 })).toBe(5);
    expect(s.alive).toBe(0);
    expect(s.pendingCount).toBe(1);
    expect(s.active).toBe(true);
    s.step(0.4);
    expect(s.alive).toBe(0);
    s.step(0.2);
    expect(s.pendingCount).toBe(0);
    expect(s.alive).toBe(5);
    for (const p of s.snapshot()) expect(p.age).toBeCloseTo(0.1, 3);
  });

  it("caps the number of waiting bursts", () => {
    const s = make(27);
    let accepted = 0;
    for (let i = 0; i < 200; i++) if (s.burst("dust", ORIGIN, { delay: 1 }) > 0) accepted++;
    expect(accepted).toBe(64);
  });
});

describe("rings", () => {
  it("grows with ease-out from 12% to full size while thinning and fading", () => {
    const start = ringShape(0, 100, 4);
    const mid = ringShape(0.5, 100, 4);
    const end = ringShape(1, 100, 4);
    expect(start.radius).toBeCloseTo(12);
    expect(end.radius).toBeCloseTo(100);
    expect(mid.radius).toBeGreaterThan(56); // ease-out: more than halfway at half time
    expect(start.width).toBe(4);
    expect(end.width).toBeCloseTo(1.4);
    expect(start.alpha).toBeCloseTo(0.95);
    expect(end.alpha).toBe(0);
    let last = ringShape(0, 80, 3);
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const r = ringShape(t, 80, 3);
      expect(r.radius).toBeGreaterThanOrEqual(last.radius);
      expect(r.alpha).toBeLessThanOrEqual(last.alpha);
      expect(r.width).toBeLessThanOrEqual(last.width);
      last = r;
    }
    expect(ringShape(-1, 10, 2).radius).toBeCloseTo(1.2);
    expect(ringShape(5, 10, 2).radius).toBe(10);
  });

  it("lives for its duration, honours delay, and then goes away", () => {
    const s = make(30);
    s.ring(ORIGIN, { duration: 500, size: 50, delay: 0.2 });
    expect(s.ringCount).toBe(1);
    expect(s.active).toBe(true);
    s.step(0.1);
    expect(s.ringSnapshot()[0].age).toBeLessThan(0); // still waiting
    s.step(0.3); // 0.2 delay + 0.2 s of life
    const r = s.ringSnapshot()[0];
    expect(r.age).toBeCloseTo(0.2, 3);
    expect(r.radius).toBeGreaterThan(6);
    s.step(0.4);
    expect(s.ringCount).toBe(0);
    expect(s.active).toBe(false);
  });

  it("recycles beyond MAX_RINGS instead of growing", () => {
    const s = make(31);
    for (let i = 0; i < MAX_RINGS + 10; i++) s.ring({ x: i, y: 0 });
    expect(s.ringCount).toBe(MAX_RINGS);
  });
});

describe("drawing", () => {
  const recorder = () => {
    const alphas: number[] = [];
    const ops: string[] = [];
    const draws: number[][] = [];
    const ctx = {
      setTransform: vi.fn(),
      drawImage: vi.fn((_img: unknown, ...a: number[]) => {
        draws.push(a);
        alphas.push(ctx.globalAlpha);
      }),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      _alpha: 1,
      _op: "source-over",
      get globalAlpha() {
        return this._alpha;
      },
      set globalAlpha(v: number) {
        this._alpha = v;
      },
      get globalCompositeOperation() {
        return this._op;
      },
      set globalCompositeOperation(v: string) {
        this._op = v;
        ops.push(v);
      },
    };
    return { ctx: ctx as unknown as Ctx2D, alphas, ops, draws, raw: ctx };
  };

  it("draws every kind with finite numbers and restores the context", () => {
    const s = new ParticleSystem({ rng: mulberry32(40), createCanvas: fakeCanvas });
    for (const k of KINDS) s.burst(k, { x: 200, y: 300 }, { count: 12 });
    s.ring({ x: 200, y: 300 }, { size: 80 });
    for (let i = 0; i < 6; i++) s.step(1 / 30);
    const { ctx, alphas, ops, draws, raw } = recorder();
    s.draw(ctx, 2);
    expect(draws.length).toBeGreaterThan(20);
    for (const a of draws.flat()) expect(Number.isFinite(a)).toBe(true);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(ops).toContain("lighter"); // neon kinds are additive
    expect(ops[ops.length - 1]).toBe("source-over");
    expect(raw._alpha).toBe(1);
    expect(raw.arc).toHaveBeenCalled();
  });

  it("draws nothing when idle", () => {
    const s = make(41);
    const { ctx, draws, raw } = recorder();
    s.draw(ctx);
    expect(draws).toHaveLength(0);
    expect(raw.setTransform).not.toHaveBeenCalled();
  });

  it("reuses sprites instead of creating one per particle", () => {
    const created = vi.fn(fakeCanvas);
    const s = new ParticleSystem({ rng: mulberry32(42), createCanvas: created });
    s.burst("sparks", ORIGIN, { count: 60, color: "#ff0000" });
    s.step(0.05);
    const { ctx } = recorder();
    s.draw(ctx);
    s.step(0.05);
    s.draw(ctx);
    expect(created).toHaveBeenCalledTimes(1); // one colour, one shape
  });

  it("copes with a missing canvas factory (no document)", () => {
    const s = make(43);
    s.burst("embers", ORIGIN);
    s.step(0.1);
    const { ctx, draws } = recorder();
    expect(() => s.draw(ctx)).not.toThrow();
    expect(draws).toHaveLength(0);
  });

  it("sanity: the palette colours resolve", () => {
    expect(parseColor("hsl(24 95% 58%)").r).toBeGreaterThan(200);
  });
});

describe("hostile options", () => {
  const NASTY = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it("a burst with non-finite options falls back to its defaults — no NaN particles, nothing stuck in the pool", () => {
    for (const bad of NASTY) {
      for (const kind of KINDS) {
        const s = make(4);
        s.burst(kind, ORIGIN, { count: bad, power: bad, spread: bad, angle: bad, delay: bad });
        s.step(0.016);
        for (const p of s.snapshot()) {
          for (const v of [p.x, p.y, p.vx, p.vy, p.size, p.age, p.life, p.alpha]) expect(Number.isFinite(v), `${kind} ${bad}`).toBe(true);
        }
        for (let i = 0; i < 400; i++) s.step(0.05); // everything ends within 20 s
        expect(s.alive, `${kind} ${bad} never finishes`).toBe(0);
        expect(s.active).toBe(false);
      }
    }
  });

  it("a ring with non-finite options still expires, so the render loop can stop", () => {
    for (const bad of NASTY) {
      const s = make(5);
      s.ring(ORIGIN, { delay: bad, duration: bad, size: bad, width: bad });
      expect(s.ringCount).toBe(1);
      for (let i = 0; i < 400; i++) s.step(0.05);
      expect(s.ringCount, `delay ${bad} leaves a ring forever`).toBe(0);
      expect(s.active).toBe(false);
    }
  });
});
