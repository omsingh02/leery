import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * What the felt gives up, one step per level, when its content doesn't fit. A `pile` step makes the pile smaller
 * (`fitPileUnit`); the others are named for `data-fit-drop`, which game.css reacts to (`.fit-*`):
 *
 *   1 the sub-line under the banner · 2 a smaller pile · 3 the rank dial · 4 the smallest regular pile ·
 *   5 the small label above the banner and the prompt under it · 6 the pile beside the banner instead of under it,
 *   with a thinner felt border and a smaller title · 7 a still smaller pile.
 *
 * The arc layout (desktop) stops at 5. Phones get the last two because a 25-card hand, or eight opponents on a
 * 553px-tall Safari (an iPhone SE with its toolbars), leave the felt barely 70px.
 */
const STEPS = ["sub", "pile", "dial", "pile", "labels", "row", "pile"] as const;
export const MAX_FIT_ARC = 5;
export const MAX_FIT_PHONE = STEPS.length;

/** Space-separated names of what is dropped or rearranged at `level`, for the felt's `data-fit-drop` attribute. */
export function fitDrops(level: number): string {
  return STEPS.slice(0, level)
    .filter((step) => step !== "pile")
    .join(" ");
}

/** Pixels per em of the pile at a fit `level`, given the size it has when everything fits. Never grows with the level. */
export function fitPileUnit(level: number, base: number): number {
  if (level >= 7) return Math.min(base, 6);
  if (level >= 4) return Math.min(base, 8);
  if (level >= 2) return Math.max(8, base - 3);
  return base;
}

/**
 * The felt shows the dial, the banner and the pile, and how tall that is depends on the phone: the banner wraps
 * to more lines on a narrow screen, eight opponents need two rails above it. Rather than clip the pile (the one thing
 * that must always be visible), measure after layout and step down the levels above, one at a time, until the
 * content fits or `max` is reached. Starts over from the full picture whenever the situation (`key`) or the felt's
 * size changes. Runs before paint, so nothing flickers, and only when one of those changes (not on every render).
 */
export function useFeltFit(key: string, max: number) {
  const ref = useRef<HTMLDivElement>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  // `tick` makes "the felt was resized" a state change even when the level is already 0.
  const [fit, setFit] = useState({ key, level: 0, tick: 0 });
  const level = fit.key === key ? fit.level : 0;

  useLayoutEffect(() => {
    const felt = ref.current;
    const content = felt?.firstElementChild as HTMLElement | null | undefined;
    if (!felt || !content || level >= max) return;
    const style = getComputedStyle(felt);
    const room = felt.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (content.offsetHeight > room + 1) setFit((f) => ({ key, level: level + 1, tick: f.tick }));
  }, [key, level, max, fit.tick]);

  useEffect(() => {
    const felt = ref.current;
    if (!felt || typeof ResizeObserver === "undefined") return;
    let size = `${felt.clientWidth}x${felt.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const now = `${felt.clientWidth}x${felt.clientHeight}`;
      if (now === size) return;
      size = now;
      setFit((f) => ({ key: keyRef.current, level: 0, tick: f.tick + 1 }));
    });
    observer.observe(felt);
    return () => observer.disconnect();
  }, []);

  return { ref, level };
}
