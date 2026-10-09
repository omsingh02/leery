import type { BedName, BedState, Cue, CueOptions } from "./feel/contract";
import { prefs } from "./prefs";
import { Engine } from "./sound/engine";

export type { BedName, BedState, Cue, CueOptions };
export { CUE_NAMES } from "./sound/cues";

/**
 * Leery's audio: a small WebAudio synth — no audio files to load. Browsers only allow audio after a
 * user gesture, so call `sfx.unlock()` from a tap/click (the app does this on the first pointerup).
 * Cues are described in src/lib/sound/cues.ts; the vocabulary is src/lib/feel/contract.ts.
 */

let engine: Engine | null = null;
let wired = false;
/** What the game last asked of each bed — replayed when the engine appears (first gesture, or after unmuting). */
const bedWishes = new Map<BedName, BedState>();

type AudioCtor = typeof AudioContext;

function wirePrefs(): void {
  if (wired) return;
  wired = true;
  let wasOn = prefs.get().sound;
  prefs.subscribe(() => {
    const on = prefs.get().sound;
    if (on === wasOn) return;
    wasOn = on;
    if (on) engine?.restore();
    else engine?.silence();
  });
}

function audio(fromGesture = false): Engine | null {
  wirePrefs();
  if (!prefs.get().sound) return null;
  if (!engine) {
    // Creating a context before any user interaction only produces an autoplay warning; cues that fire
    // from timers (e.g. before the first tap after a reload) are simply skipped until the user has interacted.
    const ua = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
    if (!fromGesture && ua && !ua.hasBeenActive) return null;
    if (typeof window === "undefined") return null;
    const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      engine = new Engine(new Ctor({ latencyHint: "interactive" }));
    } catch {
      return null;
    }
    for (const [name, state] of bedWishes) engine.bed(name, state);
  }
  engine.wake();
  return engine;
}

export const sfx = {
  /** Play a cue. Never throws; silently does nothing while muted or before the first user gesture. */
  play(cue: Cue, opts?: CueOptions): void {
    try {
      audio()?.play(cue, opts);
    } catch {
      /* audio is best-effort */
    }
  },
  /** Start, update or stop a continuous bed. */
  bed(name: BedName, state: BedState): void {
    try {
      bedWishes.set(name, { ...bedWishes.get(name), ...state });
      audio()?.bed(name, state);
    } catch {
      /* audio is best-effort */
    }
  },
  /** Call from a user gesture so later cues are allowed to play. */
  unlock(): void {
    try {
      audio(true)?.unlock();
    } catch {
      /* audio is best-effort */
    }
  },
  isMuted: (): boolean => !prefs.get().sound,
  setMuted(next: boolean): void {
    prefs.set({ sound: !next });
  },
  subscribe: (listener: () => void): (() => void) => prefs.subscribe(listener),
};
