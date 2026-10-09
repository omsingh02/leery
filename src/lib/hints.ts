import { useCallback, useSyncExternalStore } from "react";
import { getPref, setPref } from "./session";

/**
 * First-time tips. Each shows once per device, only at the moment it's useful, and never blocks
 * the game. "Show tips again" in Settings resets them.
 */
export type HintId = "select" | "call" | "drag";

const KEY = "hints";
const listeners = new Set<() => void>();

function load(): ReadonlySet<HintId> {
  try {
    const raw = getPref(KEY);
    return new Set(raw ? (JSON.parse(raw) as HintId[]) : []);
  } catch {
    return new Set();
  }
}

let seen: ReadonlySet<HintId> = load();
const emit = () => listeners.forEach((l) => l());

export const hints = {
  get: (): ReadonlySet<HintId> => seen,
  has: (id: HintId): boolean => seen.has(id),
  mark(id: HintId) {
    if (seen.has(id)) return;
    seen = new Set([...seen, id]);
    setPref(KEY, JSON.stringify([...seen]));
    emit();
  },
  reset() {
    seen = new Set();
    setPref(KEY, null);
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** `show` is true while the hint is wanted (`when`) and hasn't been seen; `done()` marks it seen. */
export function useHint(id: HintId, when: boolean): { show: boolean; done: () => void } {
  const seenNow = useSyncExternalStore(hints.subscribe, () => hints.has(id), () => true);
  const done = useCallback(() => hints.mark(id), [id]);
  return { show: when && !seenNow, done };
}
