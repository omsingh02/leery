import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FxController } from "@/lib/feel/contract";
import { createFxEngine, type FxEngine } from "@/lib/fx/engine";
import { FxContext, registerFx, shakeWriter } from "@/lib/fx";
import { useEffectsReduced } from "@/lib/prefs";

/**
 * Mounts the visual-effects layer (particle canvas, flash, vignette) and provides the controller
 * through `useFx()` / `getFx()`. The layers live in a portal on <body>, fixed over the whole viewport
 * and click-through, so a transformed (shaking) ancestor can never displace or clip them.
 *
 * The controller handed out is stable for the provider's lifetime; calls made before the engine
 * has mounted (the very first render) are simply dropped.
 *
 * It also mirrors the effective "reduced effects" state (the player's setting, or the OS's while on Auto)
 * onto `<html data-effects="reduced|full">`, which the stylesheet uses to quieten every CSS animation too.
 */
export function FxProvider({ children }: { children?: ReactNode }) {
  const reduced = useEffectsReduced();
  useLayoutEffect(() => {
    document.documentElement.dataset.effects = reduced ? "reduced" : "full";
  }, [reduced]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FxEngine | null>(null);

  const controller = useMemo<FxController>(
    () => ({
      shake: (intensity, durationMs) => engineRef.current?.shake(intensity, durationMs),
      flash: (color, peak, durationMs) => engineRef.current?.flash(color, peak, durationMs),
      burst: (kind, at, opts) => engineRef.current?.burst(kind, at, opts),
      ring: (at, opts) => engineRef.current?.ring(at, opts),
      vignette: (level, color) => engineRef.current?.vignette(level, color),
    }),
    [],
  );

  useEffect(() => {
    const engine = createFxEngine({ canvas: canvasRef.current, flash: flashRef.current, vignette: vignetteRef.current, shakeTarget: shakeWriter });
    engineRef.current = engine;
    const unregister = registerFx(controller, engine.debug);
    return () => {
      unregister();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [controller]);

  const layers = (
    <div
      aria-hidden
      data-testid="fx-layer"
      style={{ position: "fixed", inset: 0, zIndex: 65, pointerEvents: "none", overflow: "hidden" }}
    >
      {/* tension vignette — hidden (and GPU-free) until a level > 0 is requested */}
      <div ref={vignetteRef} data-fx="vignette" style={{ position: "absolute", inset: 0, opacity: 0, visibility: "hidden" }} />
      {/* particles and rings — hidden while idle */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", visibility: "hidden" }} />
      {/* one-shot colour flashes (Web Animations) */}
      <div ref={flashRef} style={{ position: "absolute", inset: 0, opacity: 0 }} />
    </div>
  );

  return (
    <FxContext.Provider value={controller}>
      {children}
      {typeof document !== "undefined" ? createPortal(layers, document.body) : null}
    </FxContext.Provider>
  );
}
