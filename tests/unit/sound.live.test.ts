import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeContext } from "./helpers/fakeAudio";

/**
 * The facade (`sfx`) driving the real Engine, voices and beds on a fake AudioContext — the seams where
 * mute, unlock and the beds meet, which no stub of the Engine can exercise.
 */

type Listener = () => void;

function browser(opts: { activated?: boolean } = {}) {
  const documentListeners = new Map<string, Listener[]>();
  vi.stubGlobal("window", { AudioContext: FakeContext });
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: opts.activated ?? true } });
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: (type: string, fn: Listener) => documentListeners.set(type, [...(documentListeners.get(type) ?? []), fn]),
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
  return {
    fire: (type: string) => documentListeners.get(type)?.forEach((fn) => fn()),
  };
}

async function fresh() {
  vi.resetModules();
  const { prefs } = await import("@/lib/prefs");
  prefs.set({ sound: true, haptics: true, effects: "full" });
  const { sfx } = await import("@/lib/sound");
  return { sfx, prefs };
}

/** Moves the audio clock and the JS timers together. */
function run(ctx: FakeContext, seconds: number) {
  for (let i = 0; i < Math.round(seconds / 0.02); i++) {
    ctx.currentTime += 0.02;
    vi.advanceTimersByTime(20);
  }
}

/** Oscillators started by `act` over the next `seconds`. */
function voices(ctx: FakeContext, act: () => void, seconds: number): number {
  const before = ctx.oscillators.length;
  act();
  run(ctx, seconds);
  return ctx.oscillators.length - before;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeContext.all.length = 0;
  FakeContext.breakGraph = false;
  FakeContext.slowResume = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("beds and muting", () => {
  it("a heartbeat the game turned off while muted stays off after unmuting (and after further cycles)", async () => {
    browser();
    const { sfx } = await fresh();
    await sfx.unlock();
    const ctx = FakeContext.all[0];
    sfx.bed("heartbeat", { on: true, bpm: 110, level: 0.6 });
    run(ctx, 1);
    expect(ctx.oscillators.length).toBeGreaterThan(0); // it was thumping

    sfx.setMuted(true);
    sfx.bed("heartbeat", { on: false }); // the challenge ends while muted
    run(ctx, 3);

    expect(voices(ctx, () => sfx.setMuted(false), 3)).toBe(0);
    expect(
      voices(
        ctx,
        () => {
          sfx.setMuted(true);
          run(ctx, 1);
          sfx.setMuted(false);
        },
        3,
      ),
    ).toBe(0);
  });

  it("a heartbeat the game turned on while muted starts when the sound comes back", async () => {
    browser();
    const { sfx } = await fresh();
    await sfx.unlock();
    const ctx = FakeContext.all[0];
    sfx.setMuted(true);
    sfx.bed("heartbeat", { on: true, bpm: 100, level: 0.6 });
    run(ctx, 1);
    expect(voices(ctx, () => sfx.setMuted(false), 3)).toBeGreaterThan(0);
  });

  it("a muted game builds nothing and still remembers its beds for later", async () => {
    browser();
    const { sfx, prefs } = await fresh();
    prefs.set({ sound: false });
    sfx.bed("heartbeat", { on: true, bpm: 90, level: 0.5 });
    sfx.play("tap");
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeContext.all).toHaveLength(0);

    prefs.set({ sound: true });
    await sfx.unlock(); // the first gesture builds the engine, which replays what the game wanted
    const ctx = FakeContext.all[0];
    expect(voices(ctx, () => undefined, 3)).toBeGreaterThan(0);
  });
});

describe("unlocking", () => {
  it("resolves once the audio is running, so a confirming cue isn't dropped by a context built a moment ago", async () => {
    browser();
    FakeContext.slowResume = true;
    const { sfx } = await fresh();
    const unlocked = sfx.unlock(); // builds the engine; the browser hasn't let the context run yet
    const ctx = FakeContext.all[0];
    expect(ctx.state).toBe("suspended");

    // a cue now would be scheduled on a frozen clock and burst out late: it is skipped instead
    expect(voices(ctx, () => sfx.play("select"), 0.2)).toBe(0);

    ctx.settleResume();
    await unlocked;
    expect(ctx.state).toBe("running");
    expect(voices(ctx, () => sfx.play("select"), 0.2)).toBeGreaterThan(0);
  });

  it("resolves at once when there is nothing to unlock", async () => {
    browser();
    const { sfx, prefs } = await fresh();
    prefs.set({ sound: false });
    await expect(sfx.unlock()).resolves.toBeUndefined();
    expect(FakeContext.all).toHaveLength(0);
  });

  it("wakes a suspended context when the tab comes back", async () => {
    const page = browser();
    const { sfx } = await fresh();
    await sfx.unlock();
    sfx.play("tap"); // wires the visibility listener
    const ctx = FakeContext.all[0];
    ctx.state = "interrupted";
    const before = ctx.resumeCalls;
    page.fire("visibilitychange");
    expect(ctx.resumeCalls).toBeGreaterThan(before);
  });
});

describe("when the engine cannot be built", () => {
  it("closes the context it opened, and cues don't keep trying", async () => {
    browser();
    FakeContext.breakGraph = true;
    const { sfx } = await fresh();
    for (let i = 0; i < 20; i++) {
      sfx.play("tap");
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(FakeContext.all.length).toBeLessThanOrEqual(2);
    expect(FakeContext.all.every((c) => c.closed)).toBe(true);
  });

  it("an explicit unlock (a new gesture) tries again, and then everything works", async () => {
    browser();
    FakeContext.breakGraph = true;
    const { sfx } = await fresh();
    sfx.play("tap");
    await vi.advanceTimersByTimeAsync(300);
    const attempts = FakeContext.all.length;

    FakeContext.breakGraph = false;
    await sfx.unlock();
    expect(FakeContext.all.length).toBe(attempts + 1);
    const ctx = FakeContext.all[FakeContext.all.length - 1];
    expect(ctx.closed).toBe(false);
    expect(voices(ctx, () => sfx.play("select"), 0.2)).toBeGreaterThan(0);
  });
});
