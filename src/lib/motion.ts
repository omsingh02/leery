/**
 * Leery's motion language. One place for the springs, curves and beat lengths, so the whole game
 * moves like one thing. Small and fast is the rule: UI settles in ≤ 250 ms; only the big story
 * beats (a call, a reveal, a win) are allowed to take their time.
 *
 *   snappy  — UI that answers a touch (buttons, chips, toggles)
 *   card    — cards finding their place in a hand
 *   pop     — little celebrations (a counter bump, a check mark)
 *   slam    — things landing with weight (cards on the pile, a verdict stamp)
 *   soft    — large, calm movement (panels, banners)
 */
export const spring = {
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.9 },
  card: { type: "spring", stiffness: 460, damping: 28 },
  pop: { type: "spring", stiffness: 440, damping: 17 },
  slam: { type: "spring", stiffness: 760, damping: 21 },
  soft: { type: "spring", stiffness: 260, damping: 26 },
} as const;

/** Cubic-bezier curves (framer-motion accepts the 4-tuples directly). */
export const ease = {
  /** Fast start, long gentle settle — the default for anything that arrives. */
  out: [0.22, 1, 0.36, 1],
  /** Symmetric — things that go and come back. */
  inOut: [0.65, 0, 0.35, 1],
  /** Accelerates away — things that leave. */
  in: [0.5, 0, 0.9, 0.4],
  /** Slight overshoot — a card landing. */
  back: [0.34, 1.45, 0.64, 1],
} as const;

/** Seconds. */
export const dur = {
  instant: 0.08,
  fast: 0.16,
  base: 0.24,
  slow: 0.42,
} as const;

/** Stagger between siblings, in seconds. */
export const stagger = {
  hand: 0.016,
  seats: 0.05,
  list: 0.06,
} as const;

/** How long cards stay in the air, in seconds. */
export const FLIGHT = 0.4;

/** Linear map of `t` from [a, b] to [c, d], clamped. */
export const remap = (t: number, a: number, b: number, c: number, d: number): number => {
  if (a === b) return c;
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return c + (d - c) * k;
};
