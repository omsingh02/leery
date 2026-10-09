/**
 * Leery's visual-effects layer.
 *
 *   <FxProvider>            (src/components/fx/FxProvider.tsx) mounts the particle canvas, flash and
 *                           vignette once, near the app root
 *   useFx()                 the controller inside React components
 *   getFx()                 the same controller from plain modules (e.g. the feedback bus)
 *   shakeStyle              spread into the `style` of the element that should shake
 *
 * Every FxController call is safe at any time and a no-op when effects are reduced (prefs.effects, or
 * the OS "reduce motion" setting while on "auto"). Coordinates are viewport pixels. Try everything at
 * /dev/fx.html (npm run dev:ui).
 */
import { createContext, useContext, type CSSProperties } from "react";
import type { FxController } from "../feel/contract";
import type { FxDebug } from "./engine";

export type { FxDebug };
export { PALETTE } from "./color";

/** A controller that does nothing — used until/unless an <FxProvider> is mounted (tests, harnesses). */
export const NO_FX: FxController = {
  shake() {},
  flash() {},
  burst() {},
  ring() {},
  vignette() {},
};

export const FxContext = createContext<FxController>(NO_FX);

/** The visual-effects controller for the current screen. Safe to call without a provider. */
export function useFx(): FxController {
  return useContext(FxContext);
}

/**
 * Opt an element into the screen shake: spread this into its `style`. The element then moves with
 * `fx.shake()` (via the --fx-sx/--fx-sy/--fx-sr variables on <html>) and sits still otherwise.
 * Don't put it on an ancestor of `position: fixed` elements you want to keep pinned to the viewport.
 */
export const shakeStyle: CSSProperties = {
  transform: "translate3d(var(--fx-sx, 0px), var(--fx-sy, 0px), 0) rotate(var(--fx-sr, 0deg))",
};

/* ------------------------------------------------------------------ global access for non-React code */

interface Registration {
  controller: FxController;
  debug?: () => FxDebug;
}

const registrations: Registration[] = [];

/**
 * Make `controller` the global one (what `getFx()` returns). Returns an unregister function. The most
 * recently registered controller wins, and unregistering restores the previous one — so React
 * StrictMode's mount/unmount/mount dance and nested providers behave.
 */
export function registerFx(controller: FxController, debug?: () => FxDebug): () => void {
  const entry: Registration = { controller, debug };
  registrations.push(entry);
  return () => {
    const i = registrations.indexOf(entry);
    if (i >= 0) registrations.splice(i, 1);
  };
}

/** The mounted provider's controller, or NO_FX when there isn't one. Use from plain modules. */
export function getFx(): FxController {
  return registrations.length ? registrations[registrations.length - 1].controller : NO_FX;
}

/** Live engine stats (particle count, loop running…) for the lab and debugging; null without a provider. */
export function getFxDebug(): FxDebug | null {
  const top = registrations[registrations.length - 1];
  return top?.debug ? top.debug() : null;
}
