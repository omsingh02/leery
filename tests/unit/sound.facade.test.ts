import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefs } from "@/lib/prefs";
import { sfx } from "@/lib/sound";

beforeEach(() => {
  prefs.set({ sound: true, haptics: true, effects: "full" });
});

describe("sfx facade", () => {
  it("mute state is the sound preference, inverted", () => {
    expect(sfx.isMuted()).toBe(false);
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(prefs.get().sound).toBe(false);
    sfx.setMuted(false);
    expect(prefs.get().sound).toBe(true);
    prefs.set({ sound: false });
    expect(sfx.isMuted()).toBe(true);
  });

  it("notifies subscribers when sound is toggled, and not when nothing changed", () => {
    const listener = vi.fn();
    const off = sfx.subscribe(listener);
    sfx.setMuted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    sfx.setMuted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    sfx.setMuted(false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    sfx.setMuted(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("never throws, whatever the environment (no AudioContext here, no user gesture, muted…)", () => {
    expect(() => sfx.play("tap")).not.toThrow();
    expect(() => sfx.play("select", { n: 3, pan: 5, level: -1, dur: Number.NaN, delay: -1 })).not.toThrow();
    expect(() => sfx.play("nonsense" as never)).not.toThrow();
    expect(() => sfx.bed("heartbeat", { on: true, bpm: 90, level: 0.5 })).not.toThrow();
    expect(() => sfx.bed("heartbeat", { on: false })).not.toThrow();
    expect(() => sfx.bed("ambience", { on: true })).not.toThrow();
    expect(() => sfx.unlock()).not.toThrow();
    sfx.setMuted(true);
    expect(() => sfx.play("call")).not.toThrow();
    expect(() => sfx.bed("heartbeat", { on: true })).not.toThrow();
    expect(() => sfx.unlock()).not.toThrow();
  });
});
