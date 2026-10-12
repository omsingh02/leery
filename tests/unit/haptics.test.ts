import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HapticName } from "@/lib/feel/contract";
import {
  ESSENTIAL,
  IOS_TICKS,
  MAX_TOTAL_MS,
  MIN_GAP_MS,
  REDUCED_SCALE,
  canVibrate,
  capPattern,
  createHaptics,
  haptics,
  isIOSLike,
  levelScale,
  patternDuration,
  patternFor,
  scalePattern,
  type HapticsDeps,
} from "@/lib/haptics";
import { prefs } from "@/lib/prefs";

const ALL: HapticName[] = ["tap", "select", "deselect", "limit", "play", "land", "turn", "tick", "accept", "call", "flip", "verdictBluff", "verdictHonest", "pickup", "lastCard", "win", "lose", "error"];

function rig(over: Partial<HapticsDeps> = {}) {
  const vibrate = vi.fn((_p: number | number[]) => true);
  let t = 1000;
  const deps: HapticsDeps = { vibrate, now: () => t, enabled: () => true, reduced: () => false, activated: () => true, ...over };
  return { h: createHaptics(deps), vibrate, advance: (ms: number) => (t += ms) };
}

describe("patterns", () => {
  it("are short and crisp (nominal values)", () => {
    expect(patternFor("tap")).toEqual([6]);
    expect(patternFor("select")).toEqual([8]);
    expect(patternFor("deselect")).toEqual([5]);
    expect(patternFor("limit")).toEqual([12, 40, 12]);
    expect(patternFor("play")).toEqual([14]);
    expect(patternFor("land", { n: 2 })).toEqual([20]);
    expect(patternFor("turn")).toEqual([22, 60, 22]);
    expect(patternFor("tick")).toEqual([6]);
    expect(patternFor("accept")).toEqual([10]);
    expect(patternFor("call")).toEqual([45]);
    expect(patternFor("flip")).toEqual([8]);
    expect(patternFor("verdictBluff")).toEqual([30, 40, 50]);
    expect(patternFor("verdictHonest")).toEqual([12, 50, 12]);
    expect(patternFor("lastCard")).toEqual([18, 50, 18, 50, 40]);
    expect(patternFor("error")).toEqual([30, 40, 30]);
  });

  it("landings scale with the number of cards", () => {
    expect(patternFor("land", { n: 1 })).toEqual([16]);
    expect(patternFor("land", { n: 4 })).toEqual([28]);
    expect(patternFor("land", { n: 40 })).toEqual([28]);
    expect(patternFor("land")).toEqual([20]);
  });

  it("pick-ups stutter once per card, capped at eight", () => {
    expect(patternFor("pickup", { n: 1 })).toEqual([8]);
    expect(patternFor("pickup", { n: 3 })).toEqual([8, 22, 8, 22, 8]);
    expect(patternFor("pickup", { n: 4 })).toHaveLength(7);
    expect(patternFor("pickup", { n: 99 })).toHaveLength(15);
    expect(patternFor("pickup", { n: 0 })).toEqual([8]);
  });

  it("level 0.5 is nominal; 0 is lighter and 1 is firmer; pauses never change", () => {
    expect(levelScale(undefined)).toBeCloseTo(1, 9);
    expect(levelScale(0.5)).toBeCloseTo(1, 9);
    expect(levelScale(0)).toBeCloseTo(0.6, 9);
    expect(levelScale(1)).toBeCloseTo(1.4, 9);
    expect(levelScale(7)).toBeCloseTo(1.4, 9);
    expect(patternFor("call", { level: 1 })).toEqual([63]);
    expect(patternFor("call", { level: 0 })).toEqual([27]);
    expect(patternFor("limit", { level: 1 })).toEqual([17, 40, 17]);
  });

  it("every pattern is valid: positive integers, ending on a vibration", () => {
    for (const name of ALL) {
      for (const opts of [undefined, { n: 1 }, { n: 8, level: 0 }, { level: 1 }]) {
        const p = patternFor(name, opts);
        expect(p.length % 2, name).toBe(1);
        for (const v of p) {
          expect(Number.isInteger(v), `${name} ${v}`).toBe(true);
          expect(v, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the celebratory and soft-long patterns exist and fit the budget", () => {
    expect(patternFor("win").length).toBeGreaterThanOrEqual(5);
    expect(patternDuration(capPattern(patternFor("win")))).toBeLessThanOrEqual(MAX_TOTAL_MS);
    const lose = patternFor("lose");
    expect(lose.length).toBeGreaterThan(5); // fast duty cycle ≈ "soft"
    expect(Math.max(...lose)).toBeLessThanOrEqual(10);
    expect(patternDuration(lose)).toBeLessThanOrEqual(MAX_TOTAL_MS);
  });

  it("scalePattern only touches the vibrating segments", () => {
    expect(scalePattern([10, 50, 10], 2)).toEqual([20, 50, 20]);
    expect(scalePattern([10, 50, 10], 0.1)).toEqual([3, 50, 3]);
    expect(scalePattern([8, 8, 8], 3, true)).toEqual([8, 8, 8]);
    expect(scalePattern([10], 1)).toEqual([10]);
  });

  it("capPattern trims to the budget and never ends on a pause", () => {
    expect(capPattern([300, 50, 300], 400)).toEqual([300, 50, 50]);
    expect(capPattern([100, 50, 100, 50], 400)).toEqual([100, 50, 100]);
    expect(capPattern([10], 5)).toEqual([5]);
    expect(capPattern([10, 20, 30], 0)).toEqual([]);
    expect(capPattern([500])).toEqual([MAX_TOTAL_MS]);
  });
});

describe("gating", () => {
  it("does nothing when haptics are off", () => {
    const { h, vibrate } = rig({ enabled: () => false });
    h.play("call");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("passes single pulses as numbers and sequences as arrays", () => {
    const { h, vibrate, advance } = rig();
    h.play("select");
    expect(vibrate).toHaveBeenLastCalledWith(8);
    advance(MIN_GAP_MS);
    h.play("turn");
    expect(vibrate).toHaveBeenLastCalledWith([22, 60, 22]);
  });

  it("with reduced effects only essential patterns fire, and softer", () => {
    const { h, vibrate, advance } = rig({ reduced: () => true });
    for (const name of ALL) {
      advance(50);
      h.play(name);
    }
    const fired = vibrate.mock.calls.length;
    expect(fired).toBe(ESSENTIAL.size);
    expect([...ESSENTIAL].sort()).toEqual(["call", "error", "lastCard", "lose", "turn", "verdictBluff", "verdictHonest", "win"]);
    vibrate.mockClear();
    advance(50);
    h.play("call");
    expect(vibrate).toHaveBeenLastCalledWith(Math.round(45 * REDUCED_SCALE));
    advance(50);
    h.play("select");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("keeps the soft-long defeat pattern intact when reduced (it is already as soft as it gets)", () => {
    const { h, vibrate } = rig({ reduced: () => true });
    h.play("lose");
    expect(vibrate).toHaveBeenCalledWith(patternFor("lose"));
  });

  it("throttles bursts: at least 18 ms between events", () => {
    const { h, vibrate, advance } = rig();
    h.play("select");
    advance(10);
    h.play("select");
    expect(vibrate).toHaveBeenCalledTimes(1);
    advance(8); // 18 ms since the last one that fired
    h.play("select");
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("stays quiet until the user has interacted (browsers block it and log a warning)", () => {
    let active = false;
    const { h, vibrate, advance } = rig({ activated: () => active });
    h.play("call");
    expect(vibrate).not.toHaveBeenCalled();
    active = true;
    advance(50);
    h.play("call");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("never exceeds the total duration budget", () => {
    const { h, vibrate, advance } = rig();
    for (const name of ALL) {
      advance(50);
      h.play(name, { n: 99, level: 1 });
    }
    for (const [arg] of vibrate.mock.calls) {
      const p = Array.isArray(arg) ? arg : [arg];
      expect(patternDuration(p)).toBeLessThanOrEqual(MAX_TOTAL_MS);
    }
  });

  it("swallows errors from the platform", () => {
    const { h } = rig({
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(() => h.play("call")).not.toThrow();
  });

  it("reports whether anything can vibrate", () => {
    expect(rig().h.supported()).toBe(true);
    expect(rig({ vibrate: undefined, iosTick: () => undefined }).h.supported()).toBe(true);
    expect(rig({ vibrate: undefined }).h.supported()).toBe(false);
  });
});

describe("iOS fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const ios = () => {
    const tick = vi.fn();
    let t = 5000;
    const h = createHaptics({ iosTick: tick, now: () => t, enabled: () => true, reduced: () => false, activated: () => true });
    return { h, tick, advance: (ms: number) => (t += ms) };
  };

  it("ticks for tap-like events only", () => {
    const { h, tick, advance } = ios();
    for (const name of ALL) {
      advance(50);
      h.play(name);
    }
    vi.runAllTimers();
    // limit and error add a second tick, so total = |IOS_TICKS| + 2
    expect(tick).toHaveBeenCalledTimes(IOS_TICKS.size + 2);
    for (const name of ["turn", "flip", "pickup", "win", "lose", "tick", "land", "lastCard", "verdictBluff", "verdictHonest"] as HapticName[]) {
      expect(IOS_TICKS.has(name), name).toBe(false);
    }
  });

  it("gives two-beat events a second tick shortly after", () => {
    const { h, tick } = ios();
    h.play("error");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("respects preferences and reduced effects", () => {
    const tick = vi.fn();
    const off = createHaptics({ iosTick: tick, now: () => 1, enabled: () => false, reduced: () => false, activated: () => true });
    off.play("select");
    const reduced = createHaptics({ iosTick: tick, now: () => 1, enabled: () => true, reduced: () => true, activated: () => true });
    reduced.play("select"); // not essential
    expect(tick).not.toHaveBeenCalled();
    reduced.play("error"); // essential and a tick event
    expect(tick).toHaveBeenCalled();
  });

  it("recognises iPhones, iPads (even in desktop mode) and nothing else", () => {
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)" })).toBe(true);
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)" })).toBe(true);
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIOSLike({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toBe(false);
    expect(isIOSLike({})).toBe(false);
  });
});

describe("the app-wide instance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    prefs.set({ haptics: true, effects: "full" });
  });

  it("follows the preferences and the platform", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, maxTouchPoints: 5, userActivation: { hasBeenActive: true } });
    prefs.set({ haptics: false });
    haptics.play("call");
    expect(vibrate).not.toHaveBeenCalled();
    prefs.set({ haptics: true, effects: "full" });
    expect(haptics.supported()).toBe(true);
    haptics.play("call");
    expect(vibrate).toHaveBeenCalledWith(45);
  });

  it("reports no support without a vibration API", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    expect(haptics.supported()).toBe(false);
    expect(haptics.kind()).toBe("none");
    expect(() => haptics.play("call")).not.toThrow();
  });

  it("doesn't claim support on a desktop browser that has the API but no motor", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, maxTouchPoints: 0, userActivation: { hasBeenActive: true } });
    expect(haptics.supported()).toBe(false);
    haptics.play("call");
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe("what counts as vibration support", () => {
  it("needs the API and a touch screen", () => {
    expect(canVibrate({ vibrate: () => true, maxTouchPoints: 5 })).toBe(true);
    expect(canVibrate({ vibrate: () => true, maxTouchPoints: 0 })).toBe(false);
    expect(canVibrate({ vibrate: () => true })).toBe(false);
    expect(canVibrate({ maxTouchPoints: 5 })).toBe(false);
  });

  it("tells patterns, ticks and nothing apart", () => {
    const base = { now: () => 1, enabled: () => true, reduced: () => false, activated: () => true };
    expect(createHaptics({ ...base, vibrate: () => true }).kind()).toBe("vibrate");
    expect(createHaptics({ ...base, iosTick: () => undefined }).kind()).toBe("tick");
    expect(createHaptics({ ...base }).kind()).toBe("none");
  });
});

describe("hostile inputs", () => {
  it("never produces a NaN or empty pattern, and never sends one to the motor", () => {
    for (const name of ["land", "pickup", "play", "tap", "call"] as const) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
        const p = patternFor(name, { n: bad, level: bad });
        expect(p.length).toBeGreaterThan(0);
        expect(p.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      }
    }
    const vibrate = vi.fn(() => true);
    const h = createHaptics({ vibrate, now: () => 100, enabled: () => true, reduced: () => false, activated: () => true });
    h.play("pickup", { n: Number.NaN, level: Number.NaN });
    for (const call of vibrate.mock.calls as unknown[][]) {
      const arg = call[0] as number | number[];
      expect([arg].flat().every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
