/**
 * Choreography of a bluff reveal, in ms from when the reveal begins. The server holds the room in
 * "reveal" for 4.5 s, so even a four-card reveal finishes with a beat to spare.
 *
 *   0      the call lands (stamp, shake) · caller faces accused
 *   claim  "<Accused> claimed 2 × Sevens"
 *   emerge the played cards rise out of the pile onto the table, face-down
 *   flips  cards turn over one by one — the last one waits (drumroll) for suspense
 *   verdict BLUFF! / HONEST slams down
 *   pickup the cards sweep to whoever has to take them (face-up first, then the rest of the pile)
 *   settle the scrim lifts so the table is visible again as the counts tick up
 */
export interface RevealTimeline {
  claim: number;
  emerge: number;
  /** Start of each card's flip. */
  flips: number[];
  /** When the drumroll starts (just before the last flip). */
  drum: number;
  /** Duration of one flip. */
  flip: number;
  verdict: number;
  /** The pile starts moving to the picker. */
  pickup: number;
  /** Cards touch down on the picker (sound, counts tick). */
  land: number;
  settle: number;
}

const FLIP = 460;
const SUSPENSE = 380;

export function revealTimeline(cards: number): RevealTimeline {
  const n = Math.max(1, cards);
  const claim = 430;
  const emerge = 700;
  const first = 1250;
  const gap = 330;
  const flips: number[] = [];
  for (let i = 0; i < n - 1; i++) flips.push(first + i * gap);
  // The last card (or the only one) waits — that beat of silence is the whole game.
  flips.push(n === 1 ? first + SUSPENSE : first + (n - 2) * gap + gap + SUSPENSE);
  const last = flips[flips.length - 1];
  const verdict = last + FLIP + 90;
  const pickup = verdict + 420;
  return { claim, emerge, flips, drum: Math.max(emerge + 200, last - 420), flip: FLIP, verdict, pickup, land: pickup + 640, settle: pickup + 200 };
}

/** Joined mid-reveal? Compress the story so the verdict and pickup still land before the server moves on. */
export function revealSkip(tl: RevealTimeline, remainingMs: number): number {
  return Math.max(0, tl.land + 300 - Math.max(0, remainingMs));
}
