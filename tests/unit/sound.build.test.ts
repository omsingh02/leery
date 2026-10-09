import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating an AudioContext is slow (tens of ms on a laptop, more on a phone). It must never happen inside
 * the handler that asked for a sound — that would delay the response to the very first tap.
 */

const made: { ctx: unknown }[] = [];
const calls = { unlock: 0, play: 0, bed: 0 };

vi.mock("@/lib/sound/engine", () => ({
  Engine: class {
    constructor(readonly ctx: unknown) {
      made.push({ ctx });
    }
    wake() {}
    unlock() {
      calls.unlock++;
    }
    play() {
      calls.play++;
    }
    bed() {
      calls.bed++;
    }
    silence() {}
    restore() {}
  },
}));

class FakeContext {
  state = "suspended";
}

/** A browser, as far as the audio facade can tell: a window (with or without Web Audio) and the activation state. */
function browser(opts: { activation: boolean | null; webAudio?: boolean }) {
  vi.stubGlobal("window", opts.webAudio === false ? {} : { AudioContext: FakeContext });
  vi.stubGlobal("navigator", { userActivation: opts.activation === null ? undefined : { hasBeenActive: opts.activation } });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
}

async function fresh() {
  vi.resetModules();
  const { prefs } = await import("@/lib/prefs");
  prefs.set({ sound: true, haptics: true, effects: "full" });
  const { sfx } = await import("@/lib/sound");
  return { sfx, prefs };
}

beforeEach(() => {
  vi.useFakeTimers();
  made.length = 0;
  calls.unlock = calls.play = calls.bed = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("building the audio engine", () => {
  it("never builds inside the call that asked for a sound — right after the frame instead, once", async () => {
    browser({ activation: true });
    const { sfx } = await fresh();

    sfx.play("tap");
    sfx.play("tap");
    sfx.bed("heartbeat", { on: true, bpm: 80 });
    expect(made).toHaveLength(0); // not synchronously, and those first cues are simply dropped
    expect(calls.play).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(made).toHaveLength(1);
    expect(calls.bed).toBe(1); // …but the bed the game asked for is replayed onto the new engine

    sfx.play("tap");
    expect(calls.play).toBe(1);
    expect(made).toHaveLength(1);
  });

  it("builds nothing before the player has interacted (it would only earn an autoplay warning)", async () => {
    browser({ activation: false });
    const { sfx } = await fresh();
    sfx.play("turn");
    await vi.advanceTimersByTimeAsync(500);
    expect(made).toHaveLength(0);
  });

  it("prepare() — the first pointerdown — builds the engine once, however often it is called", async () => {
    browser({ activation: false }); // a touch has not "activated" the page yet while the finger is still down
    const { sfx } = await fresh();
    sfx.prepare();
    sfx.prepare();
    expect(made).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(made).toHaveLength(1);
    sfx.prepare();
    await vi.advanceTimersByTimeAsync(300);
    expect(made).toHaveLength(1);
  });

  it("unlock() runs inside a gesture, so it builds at once (if prepare() hasn't) and unlocks", async () => {
    browser({ activation: false });
    const { sfx } = await fresh();
    sfx.unlock();
    expect(made).toHaveLength(1);
    expect(calls.unlock).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    sfx.prepare();
    await vi.advanceTimersByTimeAsync(300);
    expect(made).toHaveLength(1); // a late prepare() finds the engine already there
    sfx.unlock();
    expect(calls.unlock).toBe(2);
  });

  it("builds nothing while muted", async () => {
    browser({ activation: true });
    const { sfx, prefs } = await fresh();
    prefs.set({ sound: false });
    sfx.prepare();
    sfx.play("tap");
    sfx.unlock();
    await vi.advanceTimersByTimeAsync(500);
    expect(made).toHaveLength(0);
  });

  it("survives an environment without Web Audio", async () => {
    browser({ activation: true, webAudio: false });
    const { sfx } = await fresh();
    expect(() => {
      sfx.prepare();
      sfx.play("tap");
      sfx.unlock();
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    expect(made).toHaveLength(0);
  });
});
