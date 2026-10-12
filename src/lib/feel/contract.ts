/**
 * The shared vocabulary of Leery's game feel.
 *
 * Every moment in the game is described once, as a semantic event (see `plan.ts`), and fans out to
 * three independent channels: audio cues, haptic patterns and visual FX. This file is the contract
 * between those channels — change it deliberately, and keep the three implementations in step.
 */

/* ------------------------------------------------------------------------------------------ audio */

/**
 * Audio cues. `CueOptions.n` / `level` / `dur` / `pan` are interpreted per cue (see the table).
 *
 *  cue            when                                         n                      level (0–1)        dur
 *  tap            any button press (very quiet)               –                      –                  –
 *  toggle         a switch flips                               –                      1 = on, 0 = off    –
 *  error          rejected action / toast.error               –                      –                  –
 *  copy           "copied" confirmation                        –                      –                  –
 *  join / leave   someone sits down / stands up in the lobby   –                      –                  –
 *  select         a card is selected                           selected count (1–4)   –                  –
 *  deselect       a card is deselected                         selected count left    –                  –
 *  limit          tried to select a 5th card                   –                      –                  –
 *  wave           "select my honest cards" arpeggio            how many cards         –                  –
 *  whoosh         cards leave a hand / seat                    cards thrown (1–4)     –                  ≈0.38 s flight
 *  land           cards hit the pile                           cards landed (1–4)     weight             –
 *  turn           it just became MY turn                       –                      –                  –
 *  turnOther      someone else's turn starts (soft)            –                      –                  –
 *  tick           timer tick (every second, last 10 s)         seconds left           urgency 0 → 1      –
 *  buzzer         a human turn timer ran out                   –                      –                  –
 *  accept         I accepted a play                            –                      –                  –
 *  acceptOther    someone else accepted                        –                      –                  –
 *  call           bluff called — the big beat                  –                      intensity          –
 *  drumroll       suspense before the last card flips          –                      –                  seconds
 *  flip           a revealed card turns over                   index in the reveal    –                  –
 *  good / badCard that card matched / didn't match the claim   index                  –                  –
 *  verdictBluff   "BLUFF!" stamp                               –                      –                  –
 *  verdictHonest  "HONEST" stamp                               –                      –                  –
 *  pickup         the pile sweeps to whoever picks it up       cards                  –                  sweep seconds
 *  cardTick       a hand-count counter ticks up                step (0…)              –                  –
 *  lastCard       a player is down to their last card          –                      –                  –
 *  shuffle        deck shuffle at the start of a game          –                      –                  –
 *  deal           a wave of cards is dealt                     wave index (0…)        –                  –
 *  win / lose     the game ended                               –                      –                  –
 */
export type Cue =
  | "tap" | "toggle" | "error" | "copy" | "join" | "leave"
  | "select" | "deselect" | "limit" | "wave"
  | "whoosh" | "land"
  | "turn" | "turnOther" | "tick" | "buzzer"
  | "accept" | "acceptOther" | "call"
  | "drumroll" | "flip" | "good" | "badCard" | "verdictBluff" | "verdictHonest"
  | "pickup" | "cardTick" | "lastCard"
  | "shuffle" | "deal" | "win" | "lose";

export interface CueOptions {
  /** Stereo position, −1 (left) … 1 (right). Defaults to centre. */
  pan?: number;
  /** Per-cue count / index — see the table above. */
  n?: number;
  /** Per-cue 0–1 intensity — see the table above. */
  level?: number;
  /** Per-cue duration in seconds, for stretchable cues. */
  dur?: number;
  /** Seconds from now to schedule the cue (so sound and picture land together). */
  delay?: number;
}

/** Continuous audio beds. `heartbeat` accelerates with `bpm`; `ambience` is a barely-there room tone. */
export type BedName = "heartbeat" | "ambience";
export interface BedState {
  on: boolean;
  /** Heartbeat speed in beats per minute (≈ 60–120). */
  bpm?: number;
  /** 0–1 loudness of the bed. */
  level?: number;
}

/* ---------------------------------------------------------------------------------------- haptics */

export type HapticName =
  | "tap" | "select" | "deselect" | "limit" | "play" | "land" | "turn" | "tick"
  | "accept" | "call" | "flip" | "verdictBluff" | "verdictHonest"
  | "pickup" | "lastCard" | "win" | "lose" | "error";

export interface HapticOptions {
  /** Per-pattern count (cards played, ticks to play…). */
  n?: number;
  /** 0–1 intensity. */
  level?: number;
}

/* -------------------------------------------------------------------------------------------- fx */

export interface Point {
  x: number;
  y: number;
}

export type BurstKind = "sparks" | "dust" | "embers" | "confetti" | "smoke" | "glints";

export interface BurstOptions {
  /** Particle count (the engine clamps it to its budget). */
  count?: number;
  /** CSS colour, or a list to pick from. */
  color?: string | string[];
  /** 0–1 launch speed. */
  power?: number;
  /** Cone width in degrees (360 = all around). */
  spread?: number;
  /** Centre direction in degrees (0 = right, −90 = up). */
  angle?: number;
  /** Seconds before the burst appears. */
  delay?: number;
}

export interface RingOptions {
  color?: string;
  /** Final radius in px. */
  size?: number;
  /** Milliseconds. */
  duration?: number;
  /** Stroke width in px. */
  width?: number;
  delay?: number;
}

/**
 * Visual FX. Every method is a no-op when effects are reduced, and safe to call at any time.
 * Coordinates are viewport pixels (what `getBoundingClientRect()` returns).
 */
export interface FxController {
  /** Shake the game screen. `intensity` 0–1, `durationMs` defaults to ~300. */
  shake(intensity: number, durationMs?: number): void;
  /** Flash the whole screen with `color`, peaking at `peak` (0–1) opacity. */
  flash(color: string, peak?: number, durationMs?: number): void;
  burst(kind: BurstKind, at: Point, opts?: BurstOptions): void;
  ring(at: Point, opts?: RingOptions): void;
  /** Continuous screen-edge vignette, 0 (off) – 1 (tight). Eased internally; call as often as you like. */
  vignette(level: number, color?: string): void;
}
