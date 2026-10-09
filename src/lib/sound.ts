import type { BedName, BedState, Cue, CueOptions } from "./feel/contract";
import { prefs } from "./prefs";
import { Engine } from "./sound/engine";

export type { BedName, BedState, Cue, CueOptions };
export { CUE_NAMES } from "./sound/cues";

/**
 * Leery's audio: a small WebAudio synth — no audio files to load. Browsers only allow audio after a
 * user gesture, so call `sfx.unlock()` from a tap/click (the app does this on the first pointerup, after
 * `sfx.prepare()` on the first pointerdown has built the engine).
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

/** Run `fn` once the frame being prepared has painted, so heavy setup never delays what the player just did. */
function afterPaint(fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
  // A background tab never paints; don't wait for it.
  setTimeout(run, 250);
}

/** Create the context and the engine around it. Costs tens of milliseconds (more on a phone), so never call it from an input handler. */
function build(): Engine | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const built = new Engine(new Ctor({ latencyHint: "interactive" }));
    for (const [name, state] of bedWishes) built.bed(name, state);
    return built;
  } catch {
    return null;
  }
}

let building = false;
/** Build the engine right after the current frame has painted (once), instead of inside whatever handler asked for a sound. */
function buildSoon(): void {
  if (engine || building) return;
  building = true;
  afterPaint(() => {
    building = false;
    try {
      audio(true);
    } catch {
      /* audio is best-effort */
    }
  });
}

function audio(fromGesture = false): Engine | null {
  wirePrefs();
  if (!prefs.get().sound) return null;
  if (!engine) {
    if (fromGesture) {
      engine = build();
      if (!engine) return null;
    } else {
      // Creating a context before any user interaction only produces an autoplay warning; cues that fire
      // from timers (e.g. before the first tap after a reload) are simply skipped until the user has interacted.
      const ua = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
      if (ua && !ua.hasBeenActive) return null;
      // The player has interacted but there's no engine yet: this cue is dropped, the next ones play.
      buildSoon();
      return null;
    }
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
  /**
   * Build the engine while a first tap is still down. Creating an AudioContext takes tens of milliseconds
   * (more on a phone) — done at release it would delay the very first response; done here it hides inside
   * the press. The context stays suspended until `unlock()`.
   */
  prepare(): void {
    if (prefs.get().sound) buildSoon();
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
