import { afterEach, describe, expect, it, vi } from "vitest";
import { lighten, parseColor, PALETTE, rgbaCss, rgbCss } from "@/lib/fx/color";

const rgb = (s: string) => {
  const c = parseColor(s);
  return [c.r, c.g, c.b];
};

describe("hex", () => {
  it("parses #rgb, #rgba, #rrggbb and #rrggbbaa", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#8b5cf6")).toEqual({ r: 139, g: 92, b: 246, a: 1 });
    expect(rgb("#f0a")).toEqual([255, 0, 170]);
    const withAlpha = parseColor("#ff000080");
    expect([withAlpha.r, withAlpha.g, withAlpha.b]).toEqual([255, 0, 0]);
    expect(withAlpha.a).toBeCloseTo(0.502, 2);
    expect(parseColor("#f008").a).toBeCloseTo(0.533, 2);
  });

  it("is case-insensitive and tolerates surrounding space", () => {
    expect(rgb("  #8B5CF6 ")).toEqual([139, 92, 246]);
  });

  it("rejects malformed hex", () => {
    expect(rgb("#12")).toEqual([244, 239, 228]); // ivory fallback
    expect(rgb("#gggggg")).toEqual([244, 239, 228]);
  });
});

describe("rgb()", () => {
  it("handles comma, space and slash-alpha syntax", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgb(10 20 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseColor("rgb(10 20 30 / 40%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
  });

  it("handles percentage channels and clamps out-of-range values", () => {
    expect(rgb("rgb(100% 0% 50%)")).toEqual([255, 0, 128]);
    expect(rgb("rgb(300, -5, 10)")).toEqual([255, 0, 10]);
  });
});

describe("hsl()", () => {
  it("parses the app's space-separated token form with alpha", () => {
    const c = parseColor("hsl(348 100% 62% / 0.5)");
    expect([c.r, c.g, c.b]).toEqual([255, 61, 100]);
    expect(c.a).toBe(0.5);
  });

  it("parses the legacy comma form and hsla()", () => {
    expect(rgb("hsl(348, 100%, 62%)")).toEqual([255, 61, 100]);
    const c = parseColor("hsla(348, 100%, 62%, 0.4)");
    expect([c.r, c.g, c.b, c.a]).toEqual([255, 61, 100, 0.4]);
  });

  it("matches the brand palette", () => {
    expect(rgb(PALETTE.red)).toEqual([255, 61, 100]);
    expect(rgb(PALETTE.mint)).toEqual([20, 235, 185]);
    expect(rgb(PALETTE.gold)).toEqual([252, 196, 44]);
    expect(rgb(PALETTE.violet)).toEqual([139, 92, 246]);
  });

  it("understands hue units and wraps hue around", () => {
    expect(rgb("hsl(0.5turn 100% 50%)")).toEqual(rgb("hsl(180 100% 50%)"));
    expect(rgb("hsl(540 100% 50%)")).toEqual(rgb("hsl(180 100% 50%)"));
    expect(rgb("hsl(-180 100% 50%)")).toEqual(rgb("hsl(180 100% 50%)"));
    expect(rgb("hsl(180deg 100% 50%)")).toEqual([0, 255, 255]);
  });

  it("covers every hue sextant", () => {
    expect(rgb("hsl(0 100% 50%)")).toEqual([255, 0, 0]);
    expect(rgb("hsl(60 100% 50%)")).toEqual([255, 255, 0]);
    expect(rgb("hsl(120 100% 50%)")).toEqual([0, 255, 0]);
    expect(rgb("hsl(180 100% 50%)")).toEqual([0, 255, 255]);
    expect(rgb("hsl(240 100% 50%)")).toEqual([0, 0, 255]);
    expect(rgb("hsl(300 100% 50%)")).toEqual([255, 0, 255]);
  });
});

describe("fallbacks and cache", () => {
  it("never throws: junk becomes ivory", () => {
    for (const junk of ["", "banana", "rgb()", "hsl(a b c)", "rgb(1 2)", "#", "url(x)"]) {
      expect(parseColor(junk)).toEqual({ r: 244, g: 239, b: 228, a: 1 });
    }
  });

  it("knows white, black and transparent", () => {
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("transparent").a).toBe(0);
  });

  it("returns the same (frozen) object for the same string", () => {
    const a = parseColor("hsl(10 20% 30%)");
    expect(parseColor("hsl(10 20% 30%)")).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("var(--token)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves custom properties through the document when there is one", () => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (n: string) => (n === "--bluff" ? " 348 100% 62%" : "") }));
    expect(rgb("hsl(var(--bluff))")).toEqual([255, 61, 100]);
    const withAlpha = parseColor("hsl(var(--bluff) / 0.3)");
    expect(withAlpha.a).toBe(0.3);
    expect(rgb("hsl(var(--missing, 0 0% 0%))")).toEqual([0, 0, 0]);
  });

  it("falls back to ivory when the variable can't be resolved", () => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    expect(rgb("hsl(var(--nope))")).toEqual([244, 239, 228]);
  });
});

describe("helpers", () => {
  it("formats css strings", () => {
    const c = parseColor("#8b5cf6");
    expect(rgbCss(c)).toBe("rgb(139, 92, 246)");
    expect(rgbaCss(c, 0.5)).toBe("rgba(139, 92, 246, 0.5)");
    expect(rgbaCss(c, 3)).toBe("rgba(139, 92, 246, 1)");
  });

  it("lightens towards white", () => {
    const c = lighten({ r: 0, g: 100, b: 200, a: 0.5 }, 0.5);
    expect([c.r, c.g, c.b, c.a]).toEqual([128, 178, 228, 0.5]);
    expect(lighten({ r: 10, g: 10, b: 10, a: 1 }, 1)).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
});
