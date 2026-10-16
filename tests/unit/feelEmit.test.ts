import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `feel.emit` is decoration: whatever one channel does, the others — and the caller — carry on. */

const sfxPlay = vi.fn();
const hapticsPlay = vi.fn();
const fx = { shake: vi.fn(), flash: vi.fn(), burst: vi.fn(), ring: vi.fn(), vignette: vi.fn() };
let getFxImpl: () => typeof fx = () => fx;

vi.mock("@/lib/sound", () => ({ sfx: { play: (...a: unknown[]) => sfxPlay(...a) } }));
vi.mock("@/lib/haptics", () => ({ haptics: { play: (...a: unknown[]) => hapticsPlay(...a) } }));
vi.mock("@/lib/fx", () => ({ getFx: () => getFxImpl() }));

beforeEach(() => {
  vi.useFakeTimers();
  sfxPlay.mockReset();
  hapticsPlay.mockReset();
  for (const f of Object.values(fx)) f.mockReset();
  getFxImpl = () => fx;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("feel.emit", () => {
  it("runs sound, vibration and effects from one event", async () => {
    const { feel } = await import("@/lib/feel");
    feel.emit({ type: "call", mine: true, at: { x: 10, y: 20 } });
    expect(sfxPlay).toHaveBeenCalled();
    expect(hapticsPlay).toHaveBeenCalled();
    expect(fx.shake).toHaveBeenCalled();
    expect(fx.flash).toHaveBeenCalled();
  });

  it("a failing effect neither throws nor stops the other effects", async () => {
    const { feel } = await import("@/lib/feel");
    fx.shake.mockImplementation(() => {
      throw new Error("canvas exploded");
    });
    expect(() => feel.emit({ type: "call", mine: true, at: { x: 10, y: 20 } })).not.toThrow();
    expect(sfxPlay).toHaveBeenCalled();
    expect(hapticsPlay).toHaveBeenCalled();
    expect(fx.flash).toHaveBeenCalled(); // the steps after the broken one still ran
    expect(fx.ring).toHaveBeenCalled();
  });

  it("no effects layer at all is fine too", async () => {
    const { feel } = await import("@/lib/feel");
    getFxImpl = () => {
      throw new Error("not mounted");
    };
    expect(() => feel.emit({ type: "reveal.verdict", bluff: true, at: { x: 1, y: 1 } })).not.toThrow();
    expect(sfxPlay).toHaveBeenCalled();
  });

  it("a delay postpones all three channels together", async () => {
    vi.stubGlobal("window", globalThis); // emit schedules through window.setTimeout
    const { feel } = await import("@/lib/feel");
    feel.emit({ type: "turn.mine" }, 0.5);
    expect(sfxPlay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(sfxPlay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(sfxPlay).toHaveBeenCalled();
    expect(hapticsPlay).toHaveBeenCalled();
    expect(fx.flash).toHaveBeenCalled();
  });
});
