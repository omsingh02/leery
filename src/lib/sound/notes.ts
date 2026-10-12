/**
 * Pitch material for Leery's sound design. The tonal centre is D: tension comes from D minor
 * pentatonic (D F G A C), brightness and resolution from D major pentatonic (D E F# A B).
 */

const SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** MIDI note number → frequency in Hz (A4 = 440). */
export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** "F#5" → MIDI 78. Throws on malformed names (a programming error, caught by the unit tests). */
export function noteToMidi(name: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m || !(m[1] in SEMITONE)) throw new Error(`bad note name: ${name}`);
  return (Number(m[2]) + 1) * 12 + SEMITONE[m[1]];
}

/** "D5" → 587.33 Hz. */
export const hz = (name: string): number => midiToFreq(noteToMidi(name));

/** Frequency ratio for a number of semitones. */
export const semis = (n: number): number => 2 ** (n / 12);

export const D_MINOR_PENTATONIC = ["D", "F", "G", "A", "C"] as const;
export const D_MAJOR_PENTATONIC = ["D", "E", "F#", "A", "B"] as const;

/** Card selection climbs a major-pentatonic ladder: one card = D5, four cards = A5. */
export const SELECT_LADDER = ["D5", "E5", "F#5", "A5"] as const;
/** Deselecting steps back down a minor-pentatonic ladder, indexed by how many cards stay selected. */
export const DESELECT_LADDER = ["D4", "F4", "G4", "A4"] as const;

const clampIndex = (i: number, len: number): number => Math.min(len - 1, Math.max(0, Math.round(i)));

/** Note for "n cards are now selected" (n = 1…4; out-of-range values clamp). */
export const selectNote = (n: number): string => SELECT_LADDER[clampIndex(n - 1, SELECT_LADDER.length)];
/** Note for "n cards remain selected" (n = 0…3+). */
export const deselectNote = (n: number): string => DESELECT_LADDER[clampIndex(n, DESELECT_LADDER.length)];

/** The victory run: D major pentatonic climbing past the octave. */
export const WIN_ARPEGGIO = ["D5", "E5", "F#5", "A5", "B5", "D6"] as const;
/** The honest-verdict resolve: a D major triad. */
export const HONEST_TRIAD = ["D5", "F#5", "A5"] as const;
/** The defeat figure: D minor, falling. */
export const LOSE_FIGURE = ["A4", "F4", "D4"] as const;
