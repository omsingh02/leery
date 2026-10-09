import type { ShakeTarget } from "./shake";

/**
 * The elements that move when the screen shakes. The shake writes a `transform` straight onto each
 * of them — never CSS custom properties on <html>, which would make the browser re-style the whole
 * document on every frame (it's the difference between a smooth shake and a stutter on a phone).
 */
interface Target {
  /** Registrations of this element (a component and its parent may both ask). */
  count: number;
  /** The element's own inline transform when it signed up: what it goes back to at rest. */
  rest: string;
}
const targets = new Map<HTMLElement, Target>();

/** Opt an element into the screen shake. Returns the function that opts it out again. */
export function registerShakeTarget(el: HTMLElement | null | undefined): () => void {
  if (!el) return () => undefined;
  const known = targets.get(el);
  if (known) known.count += 1;
  else targets.set(el, { count: 1, rest: el.style.transform });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const t = targets.get(el);
    if (!t) return;
    t.count -= 1;
    if (t.count > 0) return; // someone else still wants it to shake
    targets.delete(el);
    el.style.transform = t.rest;
  };
}

let x = "0px";
let y = "0px";
let r = "0deg";

const isRest = () => parseFloat(x) === 0 && parseFloat(y) === 0 && parseFloat(r) === 0;

function apply() {
  const shake = isRest() ? "" : `translate3d(${x}, ${y}, 0) rotate(${r})`;
  for (const [el, t] of targets) el.style.transform = shake ? `${t.rest} ${shake}`.trim() : t.rest;
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
