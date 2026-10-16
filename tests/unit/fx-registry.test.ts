import { describe, expect, it, vi } from "vitest";
import type { FxController } from "@/lib/feel/contract";
import { getFx, getFxDebug, NO_FX, registerFx } from "@/lib/fx";

const fake = (): FxController => ({ shake: vi.fn(), flash: vi.fn(), burst: vi.fn(), ring: vi.fn(), vignette: vi.fn() });
const debug = (alive: number) => () => ({ alive, rings: 0, pending: 0, max: 400, running: false, shaking: false, reduced: false, frames: 0, quality: { level: 0 as const, dprCap: 1.5, everyN: 1 as const, countScale: 1 } });

describe("global controller", () => {
  it("is a harmless no-op controller until a provider registers", () => {
    expect(getFx()).toBe(NO_FX);
    expect(getFxDebug()).toBeNull();
    expect(() => {
      NO_FX.shake(1);
      NO_FX.flash("#fff");
      NO_FX.burst("sparks", { x: 0, y: 0 });
      NO_FX.ring({ x: 0, y: 0 });
      NO_FX.vignette(1);
    }).not.toThrow();
  });

  it("returns the most recent registration and restores the previous one on unregister", () => {
    const a = fake();
    const b = fake();
    const unA = registerFx(a, debug(1));
    expect(getFx()).toBe(a);
    expect(getFxDebug()?.alive).toBe(1);
    const unB = registerFx(b, debug(2));
    expect(getFx()).toBe(b);
    expect(getFxDebug()?.alive).toBe(2);
    unB();
    expect(getFx()).toBe(a);
    unA();
    expect(getFx()).toBe(NO_FX);
    expect(getFxDebug()).toBeNull();
  });

  it("survives StrictMode's mount → unmount → mount order and out-of-order unregisters", () => {
    const first = fake();
    const second = fake();
    const unFirst = registerFx(first);
    unFirst();
    const unSecond = registerFx(second);
    expect(getFx()).toBe(second);
    unFirst(); // a stale cleanup must not remove someone else
    expect(getFx()).toBe(second);
    unSecond();
    expect(getFx()).toBe(NO_FX);

    const a = fake();
    const b = fake();
    const unA = registerFx(a);
    const unB = registerFx(b);
    unA(); // the older one goes first
    expect(getFx()).toBe(b);
    unB();
    expect(getFx()).toBe(NO_FX);
  });

  it("works without a debug hook", () => {
    const un = registerFx(fake());
    expect(getFxDebug()).toBeNull();
    un();
  });
});
