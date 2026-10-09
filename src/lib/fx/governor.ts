/**
 * A frame-rate governor for the particle canvas. Effects are the first thing to give when a phone
 * can't keep up: the canvas gets smaller, then half as many particles, then every other repaint —
 * and it climbs back up once the device has coped for a couple of seconds.
 *
 * It watches the real gap between animation frames (the whole page's health, not just ours), smooths
 * it, and only moves after a sustained run, with a cooldown, so it can't flap.
 */
export interface Quality {
  level: 0 | 1 | 2;
  /** Largest device-pixel-ratio the canvas is drawn at. */
  dprCap: number;
  /** Repaint every Nth frame (physics still steps every frame). */
  everyN: 1 | 2;
  /** Multiplier on every burst's particle count. */
  countScale: number;
}

export const QUALITY: readonly Quality[] = [
  { level: 0, dprCap: 1.5, everyN: 1, countScale: 1 },
  { level: 1, dprCap: 1, everyN: 1, countScale: 0.7 },
  { level: 2, dprCap: 1, everyN: 2, countScale: 0.5 },
];

/** Smoothed frame gap above which the device counts as struggling (≈ below 43 fps). */
export const SLOW_MS = 23;
/** … and below which it counts as comfortable (≈ above 55 fps). */
export const FAST_MS = 18.2;
const SLOW_RUN = 10;
const FAST_RUN = 120;
const COOLDOWN = 30;
const SMOOTHING = 0.15;
/** Gaps longer than this (tab switches, debugger pauses) are clamped so they can't drag the average on their own. */
const MAX_GAP_MS = 120;

export class FrameGovernor {
  private _level: 0 | 1 | 2 = 0;
  private ema = 16.7;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;

  get quality(): Quality {
    return QUALITY[this._level];
  }

  get smoothedMs(): number {
    return this.ema;
  }

  /** Feed the gap between two consecutive animation frames (ms). Returns true when the quality level changed. */
  observe(gapMs: number): boolean {
    const x = Math.min(MAX_GAP_MS, Math.max(1, gapMs));
    this.ema += (x - this.ema) * SMOOTHING;
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return false;
    }
    if (this.ema > SLOW_MS) {
      this.slow += 1;
      this.fast = 0;
    } else if (this.ema < FAST_MS) {
      this.fast += 1;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    if (this.slow >= SLOW_RUN && this._level < 2) {
      this._level = (this._level + 1) as 1 | 2;
    } else if (this.fast >= FAST_RUN && this._level > 0) {
      this._level = (this._level - 1) as 0 | 1;
    } else {
      return false;
    }
    this.slow = 0;
    this.fast = 0;
    this.cooldown = COOLDOWN;
    return true;
  }
}
