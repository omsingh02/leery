import type { ShakeTarget } from "./shake";

/**
 * The elements that move when the screen shakes. The shake writes a `transform` straight onto each
 * of them — never CSS custom properties on <html>, which would make the browser re-style the whole
 * document on every frame (it's the difference between a smooth shake and a stutter on a phone).
 */
const targets = new Set<HTMLElement>();

/** Opt an element into the screen shake. Returns the function that opts it out again. */
export function registerShakeTarget(el: HTMLElement | null | undefined): () => void {
  if (!el) return () => undefined;
  targets.add(el);
  return () => {
    targets.delete(el);
    el.style.transform = "";
  };
}

let x = "0px";
let y = "0px";
let r = "0deg";

const isRest = () => parseFloat(x) === 0 && parseFloat(y) === 0 && parseFloat(r) === 0;

function apply() {
  const t = isRest() ? "" : `translate3d(${x}, ${y}, 0) rotate(${r})`;
  for (const el of targets) el.style.transform = t;
}

/** What the shake engine writes its offsets to: collects x, y, rotation, then moves the registered elements once. */
export const shakeWriter: ShakeTarget = {
  style: {
    setProperty(name: string, value: string) {
      if (name === "--fx-sx") x = value;
      else if (name === "--fx-sy") y = value;
      else if (name === "--fx-sr") {
        r = value;
        apply();
      }
    },
  },
};
