import { getFx } from "../fx";
import { haptics } from "../haptics";
import { sfx } from "../sound";
import type { FxController } from "./contract";
import { plan, type FeelEvent, type FxStep } from "./plan";

export type { FeelEvent } from "./plan";
export { COLOR, plan } from "./plan";

function runFx(fx: FxController, step: FxStep) {
  switch (step.fx) {
    case "shake":
      fx.shake(step.intensity, step.durationMs);
      break;
    case "flash":
      fx.flash(step.color, step.peak, step.durationMs);
      break;
    case "burst":
      fx.burst(step.kind, step.at, step.opts);
      break;
    case "ring":
      fx.ring(step.at, step.opts);
      break;
  }
}

/**
 * Play a game-feel event: sound, vibration and visual FX, all from one description (see `plan.ts`).
 * Safe to call from anywhere, at any time; every channel is best-effort and respects the player's
 * preferences (sound, haptics, reduced effects).
 *
 * `delay` (seconds) postpones all three channels so a cue can line up with a moving picture.
 */
export const feel = {
  emit(event: FeelEvent, delay = 0): void {
    const p = plan(event);
    // Feedback is decoration: a failure in one channel (or one step) must never stop another, or the caller —
    // `callBluff` emits before it sends the request.
    const run = () => {
      for (const [cue, opts] of p.cues) sfx.play(cue, opts);
      if (p.haptic) haptics.play(p.haptic[0], p.haptic[1]);
      if (p.fx.length) {
        try {
          const fx = getFx();
          for (const step of p.fx) {
            try {
              runFx(fx, step);
            } catch {
              /* a cosmetic effect failed */
            }
          }
        } catch {
          /* no effects layer */
        }
      }
    };
    if (delay > 0) window.setTimeout(run, delay * 1000);
    else run();
  },
};
