import type { HapticName, HapticOptions } from "./feel/contract";
import { prefs } from "./prefs";

/**
 * Haptic feedback. Android gets `navigator.vibrate` patterns; iOS Safari has no Vibration API, so
 * tap-like events borrow the light tick that toggling an <input type="checkbox" switch> produces
 * (iOS 17.4+). Everything is gated by the player's preferences and kept short: haptics should
 * punctuate the picture and sound, never nag.
 */

/** A vibration pattern: [on, off, on, off, …] in milliseconds (the Vibration API's own shape). */
export type Pattern = number[];

/** No pattern may last longer than this in total. */
export const MAX_TOTAL_MS = 400;
/** Minimum gap between two haptic events (ms). */
export const MIN_GAP_MS = 18;
/** With "reduced effects" only these fire, and softer. */
export const ESSENTIAL: ReadonlySet<HapticName> = new Set<HapticName>(["turn", "call", "verdictBluff", "verdictHonest", "error", "lastCard", "win", "lose"]);
/** The events that get the iOS single-tick fallback. */
export const IOS_TICKS: ReadonlySet<HapticName> = new Set<HapticName>(["tap", "select", "deselect", "play", "call", "accept", "limit", "error"]);
/** Intensity multiplier applied to essential patterns while effects are reduced. */
export const REDUCED_SCALE = 0.6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `level` 0…1 → a multiplier on the on-times: 0 → 0.6, 0.5 (nominal) → 1, 1 → 1.4. */
export const levelScale = (level: number | undefined): number => 0.6 + 0.8 * clamp(level ?? 0.5, 0, 1);

/** Nominal patterns (level 0.5). Short and crisp. */
export function patternFor(name: HapticName, opts: HapticOptions = {}): Pattern {
  const n = opts.n;
  let base: Pattern;
  switch (name) {
    case "tap": base = [6]; break;
    case "select": base = [8]; break;
    case "deselect": base = [5]; break;
    case "limit": base = [12, 40, 12]; break;
    case "play": base = [14]; break;
    case "land": base = [12 + 4 * clamp(Math.round(n ?? 2), 1, 4)]; break;
    case "turn": base = [22, 60, 22]; break;
    case "tick": base = [6]; break;
    case "accept": base = [10]; break;
    case "call": base = [45]; break;
    case "flip": base = [8]; break;
    case "verdictBluff": base = [30, 40, 50]; break;
    case "verdictHonest": base = [12, 50, 12]; break;
    case "pickup": {
      const ticks = clamp(Math.round(n ?? 4), 1, 8);
      base = [];
      for (let i = 0; i < ticks; i++) base.push(8, 22);
      base.pop(); // no trailing pause
      break;
    }
    case "lastCard": base = [18, 50, 18, 50, 40]; break;
    case "win": base = [16, 40, 16, 40, 16, 40, 16, 40, 70]; break;
    // "soft and long": a single motor pulse can't be soft, so approximate it with a fast 50 % duty cycle
    case "lose": base = Array.from({ length: 15 }, () => 8); break;
    case "error": base = [30, 40, 30]; break;
    default: base = [10];
  }
  return scalePattern(base, levelScale(opts.level), name === "lose");
}

/** Scales the vibrating segments (even indices); pauses stay put. `keepPulses` leaves PWM-style patterns alone. */
export function scalePattern(pattern: Pattern, k: number, keepPulses = false): Pattern {
  if (keepPulses || k === 1) return [...pattern];
  return pattern.map((v, i) => (i % 2 === 0 ? Math.max(3, Math.round(v * k)) : v));
}

export const patternDuration = (pattern: Pattern): number => pattern.reduce((s, v) => s + v, 0);

/** Trims a pattern to at most `maxMs` in total, never ending on a pause. */
export function capPattern(pattern: Pattern, maxMs = MAX_TOTAL_MS): Pattern {
  const out: Pattern = [];
  let total = 0;
  for (let i = 0; i < pattern.length; i++) {
    const room = maxMs - total;
    if (room <= 0) break;
    const v = Math.min(pattern[i], room);
    out.push(v);
    total += v;
  }
  while (out.length > 1 && out.length % 2 === 0) out.pop(); // end on a vibration
  return out;
}

export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** iPhone, iPad, iPod — including iPadOS pretending to be a Mac. */
export function isIOSLike(nav: NavigatorLike): boolean {
  return /iP(hone|ad|od)/.test(nav.userAgent ?? "") || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}

/* ---------------------------------------------------------------------------------------- engine */

export interface HapticsDeps {
  /** `navigator.vibrate`, or undefined where unsupported. */
  vibrate?: (pattern: number | number[]) => boolean;
  /** One light tick (the iOS switch trick), or undefined. */
  iosTick?: () => void;
  now: () => number;
  /** Player preference. */
  enabled: () => boolean;
  /** Effects reduced (OS or in-app)? */
  reduced: () => boolean;
  /** Has the user interacted with the page yet? (Browsers block vibration before that and log a warning.) */
  activated: () => boolean;
}

export interface Haptics {
  play(name: HapticName, opts?: HapticOptions): void;
  supported(): boolean;
}

export function createHaptics(deps: HapticsDeps): Haptics {
  let last = -Infinity;
  return {
    supported: () => Boolean(deps.vibrate || deps.iosTick),
    play(name, opts) {
      try {
        if (!deps.enabled()) return;
        const reduced = deps.reduced();
        if (reduced && !ESSENTIAL.has(name)) return;
        const t = deps.now();
        if (t - last < MIN_GAP_MS) return;

        if (deps.vibrate) {
          if (!deps.activated()) return;
          let pattern = patternFor(name, opts);
          if (reduced) pattern = scalePattern(pattern, REDUCED_SCALE, name === "lose");
          pattern = capPattern(pattern);
          last = t;
          deps.vibrate(pattern.length === 1 ? pattern[0] : pattern);
        } else if (deps.iosTick && IOS_TICKS.has(name)) {
          last = t;
          deps.iosTick();
          // two-beat events get a second tick shortly after (best effort — iOS may require the gesture)
          if (name === "limit" || name === "error") setTimeout(() => deps.iosTick?.(), 70);
        }
      } catch {
        /* haptics are best-effort */
      }
    },
  };
}

/** A hidden iOS "switch" checkbox whose label we click to get a light haptic tick. */
function makeIosTick(): (() => void) | undefined {
  if (typeof document === "undefined" || typeof navigator === "undefined") return undefined;
  if (typeof navigator.vibrate === "function" || !isIOSLike(navigator)) return undefined;
  let label: HTMLLabelElement | null = null;
  return () => {
    try {
      if (!label) {
        label = document.createElement("label");
        label.setAttribute("aria-hidden", "true");
        label.style.display = "none";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("switch", "");
        input.tabIndex = -1;
        label.appendChild(input);
        document.head.appendChild(label);
      }
      label.click();
    } catch {
      /* not allowed here */
    }
  };
}

let iosTick: (() => void) | undefined | null = null; // null = not probed yet

function defaultDeps(): HapticsDeps {
  return {
    get vibrate() {
      return typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? (p: number | number[]) => navigator.vibrate(p) : undefined;
    },
    get iosTick() {
      if (iosTick === null) iosTick = makeIosTick();
      return iosTick;
    },
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    enabled: () => prefs.get().haptics,
    reduced: () => prefs.effectsReduced(),
    activated: () => (typeof navigator !== "undefined" && navigator.userActivation ? navigator.userActivation.hasBeenActive : true),
  };
}

/** The app-wide instance. */
export const haptics: Haptics = createHaptics(defaultDeps());
