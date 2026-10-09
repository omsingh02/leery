import { useSyncExternalStore } from "react";
import { getPref, isMuted, setMutedPref, setPref } from "./session";

/**
 * Comfort settings. They are the player's, not the game's: sound, haptics and how much the screen is
 * allowed to move. Persisted per device; `effects: "auto"` follows the operating system's
 * "reduce motion" setting.
 */
export type EffectsPref = "auto" | "full" | "reduced";

export interface Prefs {
  /** Sound effects on. (Stored as the legacy "muted" flag so existing mutes survive.) */
  sound: boolean;
  /** Vibration feedback on. */
  haptics: boolean;
  /** Screen shake, flashes, particles. */
  effects: EffectsPref;
}

const EFFECTS: readonly EffectsPref[] = ["auto", "full", "reduced"];

function load(): Prefs {
  const effects = getPref("effects") as EffectsPref | null;
  return {
    sound: !isMuted(),
    haptics: getPref("haptics") !== "0",
    effects: effects && EFFECTS.includes(effects) ? effects : "auto",
  };
}

let state: Prefs = load();
const listeners = new Set<() => void>();

const systemReduced = (): boolean => {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const prefs = {
  get: (): Prefs => state,
  set(patch: Partial<Prefs>) {
    const next = { ...state, ...patch };
    if (next.sound === state.sound && next.haptics === state.haptics && next.effects === state.effects) return;
    state = next;
    if (patch.sound !== undefined) setMutedPref(!patch.sound);
    if (patch.haptics !== undefined) setPref("haptics", patch.haptics ? "1" : "0");
    if (patch.effects !== undefined) setPref("effects", patch.effects);
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Are big movements (shake, flashes, particles, long flights) switched off? */
  effectsReduced: (): boolean => (state.effects === "auto" ? systemReduced() : state.effects === "reduced"),
};

/** Re-render when any preference changes. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

/** True when effects are reduced (explicitly, or via the OS setting while on "auto"). */
export function useEffectsReduced(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const off = prefs.subscribe(cb);
      let mq: MediaQueryList | null = null;
      try {
        mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        mq.addEventListener("change", cb);
      } catch {
        /* no matchMedia */
      }
      return () => {
        off();
        mq?.removeEventListener("change", cb);
      };
    },
    prefs.effectsReduced,
    () => false,
  );
}
