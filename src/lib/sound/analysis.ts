/**
 * Measurement tools for rendered audio: levels, spectrum, spectrogram. Pure functions over Float32Arrays,
 * used by scripts/audio-check.mjs (in the browser, on OfflineAudioContext renders) and by unit tests.
 */

export const toDb = (linear: number): number => 20 * Math.log10(Math.max(linear, 1e-12));

export function peakOf(x: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Mean of squares over [from, to). */
function meanSquare(x: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(x.length, to);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return s / (b - a);
}

/** Plain RMS (linear) of one channel. */
export const rmsOf = (x: ArrayLike<number>, from = 0, to = x.length): number => Math.sqrt(meanSquare(x, from, to));

/** Mean value (DC offset) of one channel. */
export function dcOf(x: ArrayLike<number>): number {
  if (!x.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

/** Number of samples at or beyond ±0.999. */
export function clippedCount(x: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.999) n++;
  return n;
}

/** Stereo "power" level over [from, to): sqrt of the sum of the channels' mean squares (pan-invariant for equal-power panning). */
export function stereoRms(channels: ArrayLike<number>[], from: number, to: number): number {
  let s = 0;
  for (const ch of channels) s += meanSquare(ch, from, to);
  return Math.sqrt(s);
}

export interface Envelope {
  /** Level (linear, stereo power) per hop. */
  values: Float32Array;
  /** Samples per hop. */
  hop: number;
  /** Samples per analysis window. */
  win: number;
}

/** Short-time RMS envelope (5 ms window, 1 ms hop by default). */
export function envelopeOf(channels: ArrayLike<number>[], sampleRate: number, winMs = 5, hopMs = 1): Envelope {
  const win = Math.max(1, Math.round((sampleRate * winMs) / 1000));
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const len = channels[0]?.length ?? 0;
  const n = Math.max(0, Math.floor((len - win) / hop) + 1);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = stereoRms(channels, i * hop, i * hop + win);
  return { values, hop, win };
}

/** First and last hop index whose level is ≥ `threshold` (linear), or null. */
export function spanAbove(env: Envelope, threshold: number): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < env.values.length; i++) {
    if (env.values[i] >= threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : { first, last };
}

/* ------------------------------------------------------------------------------------- spectrum */

/** In-place radix-2 FFT. `re`/`im` lengths must be equal powers of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Spectrogram {
  /** Magnitude frames (linear, scaled so a full-scale sine reads ≈ 1), each `size / 2 + 1` bins. */
  frames: Float32Array[];
  /** Hz per bin. */
  binHz: number;
  /** Seconds per frame hop. */
  hopSec: number;
  size: number;
}

/** Short-time Fourier transform of a mono signal (Hann window). */
export function stft(x: ArrayLike<number>, sampleRate: number, size = 1024, hop = 256): Spectrogram {
  const win = new Float64Array(size);
  let wsum = 0;
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    wsum += win[i];
  }
  const frames: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bins = size / 2 + 1;
  const total = Math.max(1, Math.ceil((x.length - size) / hop) + 1);
  for (let f = 0; f < total; f++) {
    const off = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = (off + i < x.length ? x[off + i] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    for (let k = 0; k < bins; k++) mag[k] = (2 * Math.hypot(re[k], im[k])) / wsum;
    frames.push(mag);
  }
  return { frames, binHz: sampleRate / size, hopSec: hop / sampleRate, size };
}

/** Mono mix of equal-length channels. */
export function mixDown(channels: ArrayLike<number>[]): Float32Array {
  const len = channels[0]?.length ?? 0;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Magnitude-weighted mean frequency of the spectrogram frames in [fromFrame, toFrame]. */
export function centroidOf(sg: Spectrogram, fromFrame: number, toFrame: number): number {
  let num = 0;
  let den = 0;
  const a = Math.max(0, fromFrame);
  const b = Math.min(sg.frames.length - 1, toFrame);
  for (let f = a; f <= b; f++) {
    const m = sg.frames[f];
    for (let k = 1; k < m.length; k++) {
      num += k * sg.binHz * m[k];
      den += m[k];
    }
  }
  return den > 0 ? num / den : 0;
}

/** Fraction (0…1) of the spectral energy above `fromHz` in frames [fromFrame, toFrame]. */
export function highFraction(sg: Spectrogram, fromFrame: number, toFrame: number, fromHz = 8000): number {
  let hi = 0;
  let all = 0;
  const a = Math.max(0, fromFrame);
  const b = Math.min(sg.frames.length - 1, toFrame);
  for (let f = a; f <= b; f++) {
    const m = sg.frames[f];
    for (let k = 1; k < m.length; k++) {
      const e = m[k] * m[k];
      all += e;
      if (k * sg.binHz >= fromHz) hi += e;
    }
  }
  return all > 0 ? hi / all : 0;
}

/* ---------------------------------------------------------------------------------------- report */

/** Second-order Butterworth highpass (RBJ biquad), returns a new array. */
export function highpass(x: ArrayLike<number>, sampleRate: number, fc: number): Float32Array {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Drops everything after the last sample above `threshold` (+ `padSec`), so images and stats ignore the silent tail. */
export function trimTail(channels: Float32Array[], sampleRate: number, threshold = 3e-4, padSec = 0.04): Float32Array[] {
  let last = 0;
  for (const ch of channels) for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > threshold) { last = i; break; }
  const end = Math.min(channels[0]?.length ?? 0, last + Math.round(sampleRate * padSec));
  return channels.map((c) => c.subarray(0, end));
}

export interface Metrics {
  /** Seconds covered by the render. */
  lengthMs: number;
  /** Where the sound starts (envelope ≥ −50 dBFS), ms. */
  onsetMs: number;
  /** Audible length: envelope within 40 dB of its own peak, ms. */
  durationMs: number;
  peakDb: number;
  /** Stereo RMS over the active span (envelope ≥ −50 dBFS). */
  rmsDb: number;
  /** The same, after a 200 Hz highpass: what a phone speaker can actually reproduce. */
  rmsMidDb: number;
  crestDb: number;
  centroidHz: number;
  /** Share of the spectral energy above 8 kHz (0…1). */
  hfShare: number;
  /** Largest |mean| over the channels. */
  dc: number;
  clipped: number;
  /** Level of the last 50 ms. */
  tailDb: number;
}

/** Everything scripts/audio-check.mjs asserts on, for one stereo render. */
export function analyze(channels: ArrayLike<number>[], sampleRate: number): Metrics {
  const len = channels[0]?.length ?? 0;
  const peak = Math.max(...channels.map(peakOf), 0);
  const env = envelopeOf(channels, sampleRate);
  const envPeak = env.values.reduce((m, v) => (v > m ? v : m), 0);
  const active = spanAbove(env, 10 ** (-50 / 20));
  const audible = envPeak > 0 ? spanAbove(env, envPeak * 10 ** (-40 / 20)) : null;
  const hopMs = (env.hop / sampleRate) * 1000;
  const winMs = (env.win / sampleRate) * 1000;

  let rmsDb = -Infinity;
  let rmsMidDb = -Infinity;
  let onsetMs = 0;
  let centroid = 0;
  let hfShare = 0;
  if (active) {
    const from = active.first * env.hop;
    const to = active.last * env.hop + env.win;
    rmsDb = toDb(stereoRms(channels, from, to));
    rmsMidDb = toDb(stereoRms(channels.map((c) => highpass(c, sampleRate, 200)), from, to));
    onsetMs = (active.first * env.hop * 1000) / sampleRate;
    const sg = stft(mixDown(channels), sampleRate);
    const f0 = Math.floor(from / (sg.hopSec * sampleRate));
    const f1 = Math.ceil(to / (sg.hopSec * sampleRate));
    centroid = centroidOf(sg, f0, f1);
    hfShare = highFraction(sg, f0, f1);
  }
  const durationMs = audible ? (audible.last - audible.first) * hopMs + winMs : 0;
  const tailFrom = Math.max(0, len - Math.round(sampleRate * 0.05));
  return {
    lengthMs: (len / sampleRate) * 1000,
    onsetMs,
    durationMs,
    peakDb: toDb(peak),
    rmsDb,
    rmsMidDb,
    crestDb: toDb(peak) - rmsDb,
    centroidHz: centroid,
    hfShare,
    dc: Math.max(...channels.map((c) => Math.abs(dcOf(c))), 0),
    clipped: channels.reduce((n, c) => n + clippedCount(c), 0),
    tailDb: toDb(stereoRms(channels, tailFrom, len)),
  };
}

/* ------------------------------------------------------------------------------- spectrogram image */

const PALETTE: [number, number, number][] = [
  [8, 6, 20],
  [48, 18, 96],
  [112, 31, 136],
  [201, 52, 112],
  [247, 140, 56],
  [252, 230, 140],
];

function colour(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v)) * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(x));
  const f = x - i;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface SpectrogramImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
}

/**
 * Log-frequency spectrogram (60 Hz–12 kHz, top = high) over `rangeDb` dB below full scale, with the waveform
 * envelope drawn in a strip underneath. Width follows the signal length (1 px per `pxPerFrame` frames).
 */
export function spectrogramImage(channels: ArrayLike<number>[], sampleRate: number, opts: { height?: number; waveHeight?: number; rangeDb?: number; pxPerSecond?: number } = {}): SpectrogramImage {
  const specH = opts.height ?? 160;
  const waveH = opts.waveHeight ?? 36;
  const rangeDb = opts.rangeDb ?? 90;
  const mono = mixDown(channels);
  const sg = stft(mono, sampleRate, 1024, 128);
  const width = Math.max(320, Math.min(1500, Math.round((mono.length / sampleRate) * (opts.pxPerSecond ?? 800))));
  const height = specH + waveH;
  const data = new Uint8ClampedArray(width * height * 4);
  const fLo = 60;
  const fHi = Math.min(12000, sampleRate / 2);
  for (let x = 0; x < width; x++) {
    const fi = Math.min(sg.frames.length - 1, Math.floor((x / width) * sg.frames.length));
    const m = sg.frames[fi];
    for (let y = 0; y < specH; y++) {
      const f = fLo * (fHi / fLo) ** (1 - y / (specH - 1));
      const k = f / sg.binHz;
      const k0 = Math.floor(k);
      const frac = k - k0;
      const mag = m[k0] * (1 - frac) + m[Math.min(m.length - 1, k0 + 1)] * frac;
      const db = toDb(mag);
      const [r, g, b] = colour((db + rangeDb) / rangeDb);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  // waveform strip: per-column peak, mirrored around the strip's centre line
  const col = mono.length / width;
  for (let x = 0; x < width; x++) {
    let p = 0;
    for (let i = Math.floor(x * col); i < Math.min(mono.length, Math.floor((x + 1) * col)); i++) p = Math.max(p, Math.abs(mono[i]));
    const half = Math.round(p * (waveH / 2 - 1));
    for (let y = 0; y < waveH; y++) {
      const inside = Math.abs(y - waveH / 2) <= half;
      const o = ((specH + y) * width + x) * 4;
      data[o] = inside ? 150 : 14;
      data[o + 1] = inside ? 130 : 12;
      data[o + 2] = inside ? 255 : 30;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}
