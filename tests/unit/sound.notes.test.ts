import { describe, expect, it } from "vitest";
import {
  D_MAJOR_PENTATONIC,
  D_MINOR_PENTATONIC,
  DESELECT_LADDER,
  HONEST_TRIAD,
  LOSE_FIGURE,
  SELECT_LADDER,
  WIN_ARPEGGIO,
  deselectNote,
  hz,
  midiToFreq,
  noteToMidi,
  selectNote,
  semis,
} from "@/lib/sound/notes";

const pitchClass = (name: string) => name.replace(/-?\d+$/, "");

describe("note math", () => {
  it("maps MIDI numbers and names to frequencies (A4 = 440)", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("F#5")).toBe(78);
    expect(noteToMidi("Eb3")).toBe(51);
    expect(hz("D5")).toBeCloseTo(587.33, 1);
    expect(hz("F#5")).toBeCloseTo(739.99, 1);
    expect(hz("A5")).toBeCloseTo(880, 3);
  });

  it("rejects malformed note names", () => {
    expect(() => noteToMidi("H4")).toThrow();
    expect(() => noteToMidi("D")).toThrow();
    expect(() => noteToMidi("D#x")).toThrow();
  });

  it("converts semitones to ratios", () => {
    expect(semis(0)).toBe(1);
    expect(semis(12)).toBeCloseTo(2, 9);
    expect(semis(-12)).toBeCloseTo(0.5, 9);
    expect(semis(7)).toBeCloseTo(1.4983, 3);
  });
});

describe("ladders", () => {
  it("selection climbs D major pentatonic, one card per rung", () => {
    expect(SELECT_LADDER).toEqual(["D5", "E5", "F#5", "A5"]);
    const f = SELECT_LADDER.map(hz);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    for (const n of SELECT_LADDER) expect(D_MAJOR_PENTATONIC).toContain(pitchClass(n));
  });

  it("selectNote clamps to the ladder", () => {
    expect(selectNote(1)).toBe("D5");
    expect(selectNote(4)).toBe("A5");
    expect(selectNote(0)).toBe("D5");
    expect(selectNote(-3)).toBe("D5");
    expect(selectNote(9)).toBe("A5");
    expect(selectNote(2.4)).toBe("E5");
  });

  it("deselection steps down D minor pentatonic as fewer cards remain", () => {
    expect(DESELECT_LADDER).toEqual(["D4", "F4", "G4", "A4"]);
    for (const n of DESELECT_LADDER) expect(D_MINOR_PENTATONIC).toContain(pitchClass(n));
    expect(deselectNote(0)).toBe("D4");
    expect(deselectNote(1)).toBe("F4");
    expect(deselectNote(3)).toBe("A4");
    expect(deselectNote(99)).toBe("A4");
    const f = [0, 1, 2, 3].map((n) => hz(deselectNote(n)));
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
  });

  it("the victory run climbs, the defeat figure falls, the honest triad is D major", () => {
    const win = WIN_ARPEGGIO.map(hz);
    for (let i = 1; i < win.length; i++) expect(win[i]).toBeGreaterThan(win[i - 1]);
    for (const n of WIN_ARPEGGIO) expect(D_MAJOR_PENTATONIC).toContain(pitchClass(n));
    expect(HONEST_TRIAD.map(pitchClass)).toEqual(["D", "F#", "A"]);
    const lose = LOSE_FIGURE.map(hz);
    for (let i = 1; i < lose.length; i++) expect(lose[i]).toBeLessThan(lose[i - 1]);
    for (const n of LOSE_FIGURE) expect(D_MINOR_PENTATONIC).toContain(pitchClass(n));
  });
});
