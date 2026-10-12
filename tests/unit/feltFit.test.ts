import { describe, expect, it } from "vitest";
import { fitDrops, fitPileUnit, MAX_FIT_ARC, MAX_FIT_PHONE } from "@/components/game/feltFit";

const names = (level: number) => fitDrops(level).split(" ").filter(Boolean);

describe("felt fit: what is dropped at each level", () => {
  it("drops things in the documented order", () => {
    expect(names(0)).toEqual([]);
    expect(names(1)).toEqual(["sub"]);
    expect(names(2)).toEqual(["sub"]); // a smaller pile (see fitPileUnit)
    expect(names(3)).toEqual(["sub", "dial"]);
    expect(names(4)).toEqual(["sub", "dial"]); // the smallest regular pile
    expect(names(5)).toEqual(["sub", "dial", "labels"]);
    expect(names(6)).toEqual(["sub", "dial", "labels", "row"]);
    expect(names(7)).toEqual(["sub", "dial", "labels", "row"]); // a still smaller pile
  });

  it("keeps everything dropped once it is dropped", () => {
    for (let level = 1; level <= MAX_FIT_PHONE; level++) {
      for (const gone of names(level - 1)) expect(names(level)).toContain(gone);
    }
  });

  it("only phones get the pile-beside-the-banner layout", () => {
    expect(MAX_FIT_PHONE).toBeGreaterThan(MAX_FIT_ARC);
    for (let level = 0; level <= MAX_FIT_ARC; level++) expect(names(level)).not.toContain("row");
    expect(names(MAX_FIT_PHONE)).toContain("row");
  });

  it("names are single tokens, so CSS can match them with ~=", () => {
    for (let level = 0; level <= MAX_FIT_PHONE; level++) {
      for (const n of names(level)) expect(n).toMatch(/^[a-z]+$/);
    }
  });
});

describe("felt fit: pile size", () => {
  const bases = [8, 10, 13, 15]; // short phone, short desktop, phone, desktop arc

  it.each(bases)("a pile of %i px/em never grows as the felt gets tighter", (base) => {
    let last = Infinity;
    for (let level = 0; level <= MAX_FIT_PHONE; level++) {
      const unit = fitPileUnit(level, base);
      expect(unit).toBeLessThanOrEqual(last);
      last = unit;
    }
  });

  it("starts at the full size and the last resort is smaller than any regular pile", () => {
    for (const base of bases) {
      expect(fitPileUnit(0, base)).toBe(base);
      expect(fitPileUnit(MAX_FIT_PHONE, base)).toBe(6);
    }
    // The desktop arc never goes below 8.
    expect(fitPileUnit(MAX_FIT_ARC, 15)).toBe(8);
  });
});
