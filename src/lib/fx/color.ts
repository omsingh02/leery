/**
 * Colour parsing for the FX layer. Accepts what the app actually uses: hex (#rgb, #rgba, #rrggbb,
 * #rrggbbaa), rgb()/rgba() and hsl()/hsla() in both the comma and the space-separated "/ alpha"
 * syntax (so `hsl(348 100% 62% / 0.5)` works), plus `var(--token)` when running in a browser.
 * Results are cached: parsing happens once per distinct string, never per frame.
 */
export interface Rgba {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

/** Brand palette (the same hues as the CSS tokens in src/index.css). */
export const PALETTE = {
  violet: "#8b5cf6",
  pink: "#ec4899",
  red: "hsl(348 100% 62%)",
  mint: "hsl(166 84% 50%)",
  gold: "hsl(44 97% 58%)",
  ivory: "#f4efe4",
} as const;

/** What an unparseable colour becomes — ivory, which reads on every surface in the game. */
const FALLBACK: Rgba = Object.freeze({ r: 244, g: 239, b: 228, a: 1 });

const NAMED: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

const cache = new Map<string, Rgba>();
const CACHE_LIMIT = 256;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** "62%" → 0.62 · "0.5" → 0.5 · "128" with `scale` 255 → 128/255. */
function unit(token: string, scale = 1): number {
  const t = token.trim();
  if (t.endsWith("%")) return parseFloat(t) / 100;
  return parseFloat(t) / scale;
}

/** Hue token → degrees. Understands deg, turn, rad, grad and a bare number (degrees). */
function hue(token: string): number {
  const t = token.trim();
  const v = parseFloat(t);
  if (t.endsWith("turn")) return v * 360;
  if (t.endsWith("grad")) return v * 0.9;
  if (t.endsWith("rad")) return (v * 180) / Math.PI;
  return v;
}

function parseHex(hex: string): Rgba | null {
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parseFunctional(fn: string, body: string): Rgba | null {
  let main = body;
  let alphaTok: string | undefined;
  const slash = body.indexOf("/");
  if (slash >= 0) {
    main = body.slice(0, slash);
    alphaTok = body.slice(slash + 1);
  }
  const parts = main.includes(",") ? main.split(",") : main.trim().split(/\s+/);
  if (!alphaTok && parts.length === 4) alphaTok = parts.pop();
  if (parts.length !== 3) return null;
  const a = alphaTok === undefined ? 1 : clamp(unit(alphaTok), 0, 1);
  if (!Number.isFinite(a)) return null;

  if (fn.startsWith("rgb")) {
    const [r, g, b] = parts.map((p) => clamp(Math.round(unit(p, 255) * 255), 0, 255));
    return [r, g, b].every(Number.isFinite) ? { r, g, b, a } : null;
  }
  const h = hue(parts[0]);
  const s = clamp(unit(parts[1]), 0, 1);
  const l = clamp(unit(parts[2]), 0, 1);
  if (![h, s, l].every(Number.isFinite)) return null;
  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a };
}

/** Replaces `var(--x)` / `var(--x, fallback)` with the computed value, when there is a document to ask. */
function resolveVars(input: string): string | null {
  if (!input.includes("var(")) return input;
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  let failed = false;
  const out = input.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => {
    const v = style.getPropertyValue(name).trim();
    if (v) return v;
    if (fallback !== undefined) return fallback.trim();
    failed = true;
    return "";
  });
  return failed ? null : out;
}

function parse(input: string): Rgba | null {
  const resolved = resolveVars(input.trim().toLowerCase());
  if (resolved === null) return null;
  const s = resolved.trim();
  if (s.startsWith("#")) return parseHex(s);
  const named = NAMED[s];
  if (named) return named;
  const m = /^(rgba?|hsla?)\(\s*(.*?)\s*\)$/.exec(s);
  return m ? parseFunctional(m[1], m[2]) : null;
}

/** Parses any supported CSS colour. Never throws: junk becomes ivory. The returned object is shared — don't mutate it. */
export function parseColor(input: string): Rgba {
  const hit = cache.get(input);
  if (hit) return hit;
  const parsed = parse(input);
  const result: Rgba = parsed ? Object.freeze(parsed) : FALLBACK;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(input, result);
  return result;
}

/** `rgb(r g b)` for canvas/CSS use (alpha is applied separately via globalAlpha / opacity). */
export const rgbCss = (c: Rgba): string => `rgb(${c.r}, ${c.g}, ${c.b})`;

/** `rgba(r, g, b, a)`. */
export const rgbaCss = (c: Rgba, a: number): string => `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(a, 0, 1)})`;

/** Mix `c` towards white by `amount` (0–1). */
export function lighten(c: Rgba, amount: number): Rgba {
  const k = clamp(amount, 0, 1);
  return { r: Math.round(c.r + (255 - c.r) * k), g: Math.round(c.g + (255 - c.g) * k), b: Math.round(c.b + (255 - c.b) * k), a: c.a };
}
