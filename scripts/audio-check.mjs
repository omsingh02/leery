#!/usr/bin/env node
/**
 * Offline audio QA. Renders every cue (and the beds) through the SAME code and master chain the game
 * uses — inside headless Chromium, on an OfflineAudioContext — then measures and asserts:
 *
 *   • no clipping: peak ≤ −1.5 dBFS, no sample at full scale
 *   • no DC offset: |mean| < 0.002
 *   • tails are gone: the last 50 ms are below −60 dBFS
 *   • audible length within ±40 % of each cue's design target
 *   • loudness consistency: every cue's RMS within ±6 dB of the median (quiet UI ticks may sit 6–14 dB
 *     lower, impacts up to +4 dB louder)
 *
 *   node scripts/audio-check.mjs [--out DIR] [--only tap,land,…] [--no-png] [--port 5211] [--url http://…]
 *                                [--json] [--calibrate] [--write-trims] [--no-live]
 *
 * "Audible length" is measured on a dry render (no reverb), because the design targets describe the cue
 * itself; the reverb tail is checked separately (it must be gone by the end of the render). A cue's
 * "mid" RMS (200 Hz highpass) is what a phone speaker can reproduce; sub-bass must not dominate it.
 * Unless --no-live is given, a live smoke test also runs every cue, the beds, mute/unmute and a voice-budget
 * flood through the real Engine on a real AudioContext (no exceptions, ≤ 24 voices, everything cleaned up).
 * --calibrate prints the per-cue trims (dB) that would bring every loudness group to its target RMS;
 * --write-trims also rewrites the TRIMS block in src/lib/sound/cues.ts (run it twice: trims interact with
 * the master compressor). A trim never pushes a cue's peak above −4 dBFS.
 *
 * Spectrogram PNGs (log-frequency, waveform strip underneath) go to --out (default: <tmp>/leery-audio).
 * Needs Chromium: set E2E_CHROMIUM, or have /usr/bin/chromium. Exit status 1 on any violation.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

if (flag("help") || flag("h")) {
  console.log("usage: node scripts/audio-check.mjs [--out DIR] [--only a,b] [--no-png] [--port 5211] [--url URL] [--json]");
  process.exit(0);
}

const outDir = path.resolve(opt("out", path.join(tmpdir(), "leery-audio")));
const only = opt("only", "") ? opt("only", "").split(",") : null;
const withPng = !flag("no-png");
const port = Number(opt("port", "5211"));

const THRESHOLDS = { peakDb: -1.5, dc: 0.002, tailDb: -60, durTol: 0.4, band: 6, quietLow: 14, impactHigh: 4, subHeavy: 10, hfShare: 0.15 };
/** RMS (dBFS) each loudness group is calibrated to. */
const TARGET_RMS = { regular: -26, quiet: -35, impact: -23.5 };

/* ------------------------------------------------------------------------------------ browser */

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

let server = null;
let base = opt("url", `http://127.0.0.1:${port}`);
if (!opt("url", "") || !(await reachable(`${base}/dev/audio.html`))) {
  if (await reachable(`${base}/dev/audio.html`)) {
    console.log(`using the dev server already running at ${base}`);
  } else {
    // no file watching / HMR: nothing may reload the page while it is rendering (other people edit the repo meanwhile)
    server = await createServer({ root, logLevel: "error", server: { port, strictPort: true, host: "127.0.0.1", hmr: false, watch: null } });
    await server.listen();
    base = `http://127.0.0.1:${port}`;
  }
}

const exe = process.env.E2E_CHROMIUM || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(`${base}/dev/audio.html?check=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__leeryAudio, null, { timeout: 90_000 });

/** page.evaluate that survives a reload (Vite re-optimises dependencies the first time it sees them). */
async function api(fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForFunction(() => window.__leeryAudio, null, { timeout: 90_000 });
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e;
    }
  }
}

const names = await api(() => window.__leeryAudio.cues);
const specs = await api(() => window.__leeryAudio.specs);
const selected = only ? names.filter((n) => only.includes(n)) : names;

/* -------------------------------------------------------------------------------- render + measure */

mkdirSync(outDir, { recursive: true });
const save = (name, dataUrl) => {
  if (!dataUrl) return;
  const file = path.join(outDir, `${name.replace(/[^\w.@-]+/g, "_")}.png`);
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
};

const rows = [];
for (const cue of selected) {
  const r = await api(([c, png]) => window.__leeryAudio.checkCue(c, undefined, png), [cue, withPng]);
  save(cue, r.png);
  rows.push({ ...r, kind: "cue" });
}

// Stress renders: extremes of the option space must stay clean too (not part of the loudness comparison).
const stress = [
  ["land", { n: 4, level: 1 }],
  ["call", { level: 1 }],
  ["whoosh", { n: 4 }],
  ["pickup", { n: 6 }],
  ["wave", { n: 4 }],
  ["whoosh", { n: 2, pan: -1 }],
  ["pickup", { n: 5, pan: 1 }],
  ["turnOther", { pan: 1 }],
  ["acceptOther", { pan: -1 }],
  ["drumroll", { dur: 1.2 }],
  ["tick", { level: 1 }],
].filter(([c]) => !only || only.includes(c));
for (const [cue, opts] of stress) {
  const label = `${cue}${JSON.stringify(opts).replace(/[{}"]/g, "").replace(/:/g, "=")}`;
  const r = await api(([c, o, png]) => window.__leeryAudio.checkCue(c, o, png), [cue, opts, false]);
  rows.push({ ...r, cue: `${label}`, kind: "stress", target: 0 });
}
if (!only) {
  for (const [name, opts] of [["heartbeat", { bpm: 60, seconds: 3 }], ["heartbeat", { bpm: 110, seconds: 3 }], ["ambience", { seconds: 3 }]]) {
    const r = await api(([n, o, png]) => window.__leeryAudio.checkBed(n, o, png), [name, opts, withPng]);
    save(r.cue, r.png);
    rows.push({ ...r, kind: "bed", target: 0 });
  }
}
let live = null;
if (!flag("no-live") && !only) {
  live = await api(() => window.__leeryAudio.liveSmoke());
}
await browser.close();
if (server) await server.close();

/* ------------------------------------------------------------------------------------ assertions */

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const cueRows = rows.filter((r) => r.kind === "cue");
const M = median(cueRows.map((r) => r.metrics.rmsDb));
const problems = [];
const flagsOf = new Map();
const fail = (row, msg) => {
  problems.push(`${row.cue}: ${msg}`);
  flagsOf.set(row, [...(flagsOf.get(row) ?? []), msg.split(" ")[0]]);
};

for (const row of rows) {
  const m = row.metrics;
  if (m.peakDb > THRESHOLDS.peakDb) fail(row, `peak ${m.peakDb.toFixed(1)} dBFS exceeds ${THRESHOLDS.peakDb}`);
  if (m.clipped > 0) fail(row, `${m.clipped} clipped samples`);
  if (m.dc >= THRESHOLDS.dc) fail(row, `DC offset ${m.dc.toExponential(1)} ≥ ${THRESHOLDS.dc}`);
  if (m.tailDb > THRESHOLDS.tailDb) fail(row, `tail ${m.tailDb.toFixed(1)} dBFS is still above ${THRESHOLDS.tailDb} at the end`);
  if (row.kind === "cue") {
    if (m.hfShare > THRESHOLDS.hfShare) fail(row, `${(m.hfShare * 100).toFixed(0)}% of the energy is above 8 kHz (max ${THRESHOLDS.hfShare * 100}%)`);
    if (m.rmsDb - m.rmsMidDb > THRESHOLDS.subHeavy) fail(row, `sub-bass dominates: full-band RMS is ${(m.rmsDb - m.rmsMidDb).toFixed(1)} dB above the part a phone speaker plays (max ${THRESHOLDS.subHeavy})`);
    const target = row.target * 1000;
    if (Math.abs(m.durationMs / target - 1) > THRESHOLDS.durTol) fail(row, `length ${m.durationMs.toFixed(0)} ms is not within ±${THRESHOLDS.durTol * 100}% of ${target.toFixed(0)} ms`);
    const d = m.rmsDb - M;
    if (row.group === "quiet") {
      if (d < -THRESHOLDS.quietLow || d > THRESHOLDS.band) fail(row, `RMS ${d.toFixed(1)} dB vs median is outside −${THRESHOLDS.quietLow}…+${THRESHOLDS.band} (quiet cue)`);
    } else if (row.group === "impact") {
      if (d < -THRESHOLDS.band || d > THRESHOLDS.impactHigh) fail(row, `RMS ${d.toFixed(1)} dB vs median is outside −${THRESHOLDS.band}…+${THRESHOLDS.impactHigh} (impact)`);
    } else if (Math.abs(d) > THRESHOLDS.band) {
      fail(row, `RMS ${d.toFixed(1)} dB vs median is outside ±${THRESHOLDS.band}`);
    }
  }
}
for (const e of pageErrors) problems.push(`page error: ${e}`);
if (live) {
  if (live.state !== "running") problems.push(`live: AudioContext state is "${live.state}", expected "running"`);
  for (const e of live.errors) problems.push(`live: ${e}`);
  if (live.peakVoices > 24) problems.push(`live: ${live.peakVoices} simultaneous voices exceeds the cap of 24`);
  if (live.afterFlood > 24) problems.push(`live: voice cap not enforced (${live.afterFlood} active after a flood)`);
  if (live.afterCall > 24) problems.push(`live: a critical cue broke the voice cap (${live.afterCall})`);
  if (live.endVoices !== 0) problems.push(`live: ${live.endVoices} voices still active after everything should have ended`);
}

/* ----------------------------------------------------------------------------------------- report */

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
if (flag("json")) {
  console.log(JSON.stringify({ median: M, rows, problems }, null, 2));
} else {
  console.log(`\nLeery audio check — ${rows.filter((r) => r.kind === "cue").length} cues, median RMS ${num(M)} dBFS\n`);
  console.log([pad("cue", 22), pad("grp", 7), pad("len ms", 12), pad("peak", 7), pad("rms", 7), pad("mid", 7), pad("Δmed", 6), pad("crest", 6), pad("centroid", 9), pad(">8k", 5), pad("dc", 9), pad("clip", 5), pad("tail dB", 8), "flags"].join(" "));
  for (const row of rows) {
    const m = row.metrics;
    const len = row.kind === "cue" ? `${m.durationMs.toFixed(0)}/${(row.target * 1000).toFixed(0)}` : num(m.durationMs, 0);
    const d = row.kind === "cue" ? num(m.rmsDb - M) : "";
    console.log(
      [pad(row.cue, 22), pad(row.group, 7), pad(len, 12), pad(num(m.peakDb), 7), pad(num(m.rmsDb), 7), pad(num(m.rmsMidDb), 7), pad(d, 6), pad(num(m.crestDb), 6), pad(num(m.centroidHz, 0), 9), pad(`${(m.hfShare * 100).toFixed(0)}%`, 5), pad(m.dc.toExponential(0), 9), pad(m.clipped, 5), pad(num(m.tailDb, 0), 8), (flagsOf.get(row) ?? []).join(",")].join(" "),
    );
  }
  if (live) console.log(`\nlive engine: AudioContext ${live.state}, ${live.plays} plays, peak ${live.peakVoices} voices (cap 24), ${live.afterFlood} after a 60-cue flood, ${live.endVoices} left at the end, ${live.errors.length} errors`);
  console.log(`\nspectrograms: ${withPng ? outDir : "(skipped)"}`);
}

if (flag("calibrate") || flag("write-trims")) {
  // new trim = current trim + (target − measured), but never let the peak rise above −4 dBFS
  const next = cueRows.map((r) => {
    const want = TARGET_RMS[r.group] ?? TARGET_RMS.regular;
    const old = specs[r.cue]?.trimDb ?? 0;
    const delta = Math.min(want - r.metrics.rmsDb, -4 - r.metrics.peakDb);
    return [r.cue, old, Math.round((old + delta) * 2) / 2];
  });
  console.log("\nCalibrated trims (dB), current → suggested:");
  console.log(next.map(([c, o, n]) => `  ${pad(c, 14)} ${pad(o.toFixed(1), 6)} → ${n.toFixed(1)}`).join("\n"));
  if (flag("write-trims")) {
    const file = path.join(root, "src/lib/sound/cues.ts");
    const src = readFileSync(file, "utf8");
    const body = next.filter(([, , n]) => n !== 0).map(([c, , n]) => `  ${c}: ${n},`).join("\n");
    const block = `// <trims> (rewritten by \`node scripts/audio-check.mjs --write-trims\`)\nconst TRIMS: Partial<Record<Cue, number>> = {\n${body}\n};\n// </trims>`;
    const out = src.replace(/\/\/ <trims>[\s\S]*?\/\/ <\/trims>/, () => block);
    if (out === src && !src.includes("// <trims>")) throw new Error("TRIMS markers not found in cues.ts");
    writeFileSync(file, out);
    console.log(`wrote ${next.length} trims to src/lib/sound/cues.ts`);
  }
}

if (withPng && !flag("json")) {
  try {
    const files = cueRows.map((r) => path.join(outDir, `${r.cue}.png`)).filter(existsSync);
    if (files.length) {
      const sheetArgs = ["montage", ...files.flatMap((f) => ["-label", path.basename(f, ".png"), f]), "-tile", "4x", "-geometry", "560x240+4+4", "-background", "#0b0716", "-fill", "#bbb", "-pointsize", "12", path.join(outDir, "_sheet.png")];
      execFileSync("magick", sheetArgs, { stdio: "ignore" });
      console.log(`contact sheet: ${path.join(outDir, "_sheet.png")}`);
    }
  } catch {
    /* ImageMagick not installed: individual PNGs are enough */
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ all audio checks passed");
