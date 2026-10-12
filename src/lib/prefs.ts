import { useSyncExternalStore } from "react";
import { getPref, isMuted, onStorageChange, setMutedPref, setPref } from "./session";

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

let mql: MediaQueryList | null | undefined;
/** The OS "reduce motion" query, created once (components ask on every render). */
const reducedQuery = (): MediaQueryList | null => {
  if (mql === undefined) {
    try {
      mql = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    } catch {
      mql = null;
    }
  }
  return mql;
};

const systemReduced = (): boolean => reducedQuery()?.matches ?? false;

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

// Another tab changed a setting (or cleared the site data): follow it.
onStorageChange((key) => {
  if (key !== null && !key.startsWith("leery.")) return;
  const next = load();
  if (next.sound === state.sound && next.haptics === state.haptics && next.effects === state.effects) return;
  state = next;
  listeners.forEach((l) => l());
});

/** Re-render when any preference changes. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

/** Preference changes, and the OS setting changing underneath an "auto". (Module-level so the subscription isn't redone on every render.) */
function subscribeReduced(cb: () => void): () => void {
  const off = prefs.subscribe(cb);
  const mq = reducedQuery();
  mq?.addEventListener?.("change", cb);
  return () => {
    off();
    mq?.removeEventListener?.("change", cb);
  };
}

/** True when effects are reduced (explicitly, or via the OS setting while on "auto"). */
export function useEffectsReduced(): boolean {
  return useSyncExternalStore(subscribeReduced, prefs.effectsReduced, () => false);
}
