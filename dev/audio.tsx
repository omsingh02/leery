/* eslint-disable react-refresh/only-export-components -- a dev harness: components only, nothing to hot-swap */
/**
 * Audio lab — audition every cue, bed and haptic pattern, and the entry point for scripts/audio-check.mjs.
 *   npm run dev:ui   →   /dev/audio.html
 *   /dev/audio.html?check=1   exposes window.__leeryAudio (offline renders + measurements) and renders no UI.
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@/index.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BedName, Cue, CueOptions, HapticName } from "@/lib/feel/contract";
import { haptics } from "@/lib/haptics";
import { prefs, usePrefs, type EffectsPref } from "@/lib/prefs";
import { sfx } from "@/lib/sound";
import { analyze, spectrogramImage, trimTail, type Metrics } from "@/lib/sound/analysis";
import { CUES, CUE_NAMES } from "@/lib/sound/cues";
import { Engine } from "@/lib/sound/engine";
import { renderBed, renderCue } from "@/lib/sound/offline";

/* --------------------------------------------------------------------------- check API (headless) */

interface CheckResult {
  cue: string;
  group: string;
  target: number;
  /** Levels from the full (wet) render; `durationMs` is the cue's own length, measured on a dry render. */
  metrics: Metrics;
  /** Audible length including the reverb tail. */
  wetMs: number;
  png?: string;
}

async function png(channels: Float32Array[], sampleRate: number): Promise<string> {
  const img = spectrogramImage(channels, sampleRate);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas.toDataURL("image/png");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plays everything through the live engine on a real AudioContext and reports how it behaved. */
async function liveSmoke() {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  const engine = new Engine(ctx);
  const errors: string[] = [];
  let plays = 0;
  const fire = (cue: Cue, opts?: CueOptions) => {
    try {
      engine.play(cue, opts);
      plays++;
    } catch (e) {
      errors.push(`${cue}: ${String(e)}`);
    }
  };
  let peak = 0;
  const watch = setInterval(() => (peak = Math.max(peak, engine.activeVoices)), 20);

  // every cue, staggered on the audio clock, with a few option extremes
  CUE_NAMES.forEach((c, i) => fire(c, { delay: i * 0.05 }));
  fire("whoosh", { n: 4, pan: -1, delay: 0.3 });
  fire("pickup", { n: 6, pan: 1, dur: 0.8, delay: 0.4 });
  fire("drumroll", { dur: 1.2, delay: 0.5 });
  fire("land", { n: 4, level: 1, delay: 0.6 });

  // beds
  engine.bed("heartbeat", { on: true, bpm: 70, level: 0.6 });
  await sleep(600);
  engine.bed("heartbeat", { on: true, bpm: 110 });
  engine.bed("ambience", { on: true, level: 1 });
  await sleep(600);
  engine.silence();
  await sleep(100);
  engine.restore();
  await sleep(300);
  engine.bed("heartbeat", { on: false });
  engine.bed("ambience", { on: false });

  // voice budget: a flood of low-priority cues must never exceed the cap, and a critical cue still gets in
  for (let i = 0; i < 60; i++) fire("tick", { delay: 1 + i * 0.001 });
  const afterFlood = engine.activeVoices;
  fire("call", { delay: 1 });
  const afterCall = engine.activeVoices;

  // let the longest cue (win ≈ 3 s + reverb) and the clean-up timers run out
  await sleep(5200);
  clearInterval(watch);
  const endVoices = engine.activeVoices;
  const state = ctx.state;
  await ctx.close().catch(() => undefined);
  return { state, plays, errors, peakVoices: peak, afterFlood, afterCall, endVoices };
}

const api = {
  liveSmoke,
  cues: CUE_NAMES as readonly Cue[],
  specs: Object.fromEntries(CUE_NAMES.map((c) => [c, { target: CUES[c].target, group: CUES[c].group, trimDb: CUES[c].trimDb }])),
  async checkCue(cue: Cue, opts?: CueOptions, withPng = false): Promise<CheckResult> {
    const wet = await renderCue(cue, opts);
    const dry = await renderCue(cue, opts, { dry: true });
    const metrics = analyze(wet.channels, wet.sampleRate);
    const own = analyze(dry.channels, dry.sampleRate);
    return {
      cue,
      group: CUES[cue].group,
      target: CUES[cue].target,
      metrics: { ...metrics, durationMs: own.durationMs },
      wetMs: metrics.durationMs,
      png: withPng ? await png(trimTail(wet.channels, wet.sampleRate), wet.sampleRate) : undefined,
    };
  },
  async checkBed(name: BedName, opts: { bpm?: number; level?: number; seconds?: number } = {}, withPng = false): Promise<CheckResult> {
    const r = await renderBed(name, opts);
    const metrics = analyze(r.channels, r.sampleRate);
    return { cue: `bed:${name}${opts.bpm ? `@${opts.bpm}` : ""}`, group: "bed", target: 0, metrics, wetMs: metrics.durationMs, png: withPng ? await png(r.channels, r.sampleRate) : undefined };
  },
};

declare global {
  interface Window {
    __leeryAudio?: typeof api;
  }
}

const params = new URLSearchParams(window.location.search);

/* ------------------------------------------------------------------------------------------ UI */

const GROUPS: { title: string; cues: Cue[] }[] = [
  { title: "Interface", cues: ["tap", "toggle", "error", "copy", "join", "leave"] },
  { title: "Hand", cues: ["select", "deselect", "limit", "wave"] },
  { title: "Cards in motion", cues: ["whoosh", "land", "pickup", "cardTick", "shuffle", "deal"] },
  { title: "Turns and timers", cues: ["turn", "turnOther", "tick", "buzzer", "lastCard"] },
  { title: "Challenge", cues: ["accept", "acceptOther", "call"] },
  { title: "Reveal", cues: ["drumroll", "flip", "good", "badCard", "verdictBluff", "verdictHonest"] },
  { title: "Game end", cues: ["win", "lose"] },
];

const HAPTICS: HapticName[] = ["tap", "select", "deselect", "limit", "play", "land", "turn", "tick", "accept", "call", "flip", "verdictBluff", "verdictHonest", "pickup", "lastCard", "win", "lose", "error"];

const css = `
  body { color: #f5f0e6; font-family: "Inter Variable", system-ui, sans-serif; }
  .lab { max-width: 980px; margin: 0 auto; padding: 20px 16px 80px; }
  h1 { font-family: "Unbounded Variable", sans-serif; font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #a79cc4; margin: 26px 0 10px; }
  p.note { color: #a79cc4; font-size: 13px; margin: 0 0 14px; max-width: 70ch; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  button.cue { all: unset; cursor: pointer; padding: 9px 14px; border-radius: 999px; background: #1a1230; border: 1px solid #3b2d63; font-size: 14px; font-weight: 600; }
  button.cue:hover { background: #26194a; }
  button.cue:active { transform: scale(.96); }
  button.cue.on { background: #7c3aed; border-color: #a78bfa; }
  button.hap { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 10px; background: #12202a; border: 1px solid #25506a; font-size: 13px; }
  button.hap:hover { background: #18303f; }
  .panel { background: #0f0a1e; border: 1px solid #2a1f4a; border-radius: 16px; padding: 14px; }
  label.s { display: grid; grid-template-columns: 70px 1fr 46px; gap: 10px; align-items: center; font-size: 13px; color: #cfc6e6; margin: 6px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  select, input[type=checkbox] { accent-color: #8b5cf6; }
  select { background: #1a1230; color: inherit; border: 1px solid #3b2d63; border-radius: 8px; padding: 5px 8px; }
  .log { font-family: ui-monospace, monospace; font-size: 12px; color: #8f84ad; margin-top: 8px; min-height: 18px; }
`;

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="s">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>{fmt ? fmt(value) : value}</span>
    </label>
  );
}

function Lab() {
  const p = usePrefs();
  const [n, setN] = useState(2);
  const [level, setLevel] = useState(0.5);
  const [pan, setPan] = useState(0);
  const [dur, setDur] = useState(0.4);
  const [useDur, setUseDur] = useState(false);
  const [bpm, setBpm] = useState(70);
  const [beat, setBeat] = useState(0.7);
  const [heart, setHeart] = useState(false);
  const [amb, setAmb] = useState(false);
  const [last, setLast] = useState("");

  const opts = (): CueOptions => ({ n, level, pan, ...(useDur ? { dur } : {}) });
  const fire = (cue: Cue) => {
    void sfx.unlock();
    sfx.play(cue, opts());
    setLast(`${cue} ${JSON.stringify(opts())}`);
  };

  const scenario = (name: string, steps: [number, Cue, CueOptions?][], hap: [number, HapticName, { n?: number }?][] = []) => {
    void sfx.unlock();
    steps.forEach(([at, cue, o]) => sfx.play(cue, { ...o, delay: at }));
    hap.forEach(([at, h, o]) => setTimeout(() => haptics.play(h, o), at * 1000));
    setLast(`scenario: ${name}`);
  };

  const SCENARIOS: { name: string; run: () => void }[] = [
    { name: "Your turn", run: () => scenario("your turn", [[0, "turn"]], [[0, "turn"]]) },
    { name: "I play 3 cards", run: () => scenario("I play 3", [[0, "whoosh", { n: 3 }], [0.38, "land", { n: 3, level: 0.6 }]], [[0, "play"], [0.38, "land", { n: 3 }]]) },
    { name: "Opponent plays 2 (left)", run: () => scenario("opponent plays", [[0, "whoosh", { n: 2, pan: -0.6 }], [0.38, "land", { n: 2, level: 0.4 }]]) },
    { name: "Someone accepts", run: () => scenario("accept", [[0, "acceptOther", { pan: 0.5 }], [0.6, "accept"]], [[0.6, "accept"]]) },
    {
      name: "Timer: last 3 seconds",
      run: () => scenario("ticks", [[0, "tick", { level: 0.4 }], [1, "tick", { level: 0.7 }], [2, "tick", { level: 1 }], [3, "buzzer"]], [[0, "tick"], [1, "tick"], [2, "tick"], [3, "error"]]),
    },
    {
      name: "Bluff called → BLUFF!",
      run: () =>
        scenario(
          "bluff",
          [
            [0, "call"],
            [0.7, "drumroll", { dur: 0.55 }],
            [0.5, "flip", { n: 0 }],
            [0.55, "good", { n: 0 }],
            [0.9, "flip", { n: 1 }],
            [0.95, "badCard", { n: 1 }],
            [1.4, "flip", { n: 2 }],
            [1.45, "badCard", { n: 2 }],
            [2.3, "verdictBluff"],
            [3.0, "pickup", { n: 6, pan: 0.5, dur: 0.6 }],
          ],
          [[0, "call"], [0.5, "flip"], [0.9, "flip"], [1.4, "flip"], [2.3, "verdictBluff"], [3.0, "pickup", { n: 6 }]],
        ),
    },
    {
      name: "Called → HONEST",
      run: () =>
        scenario(
          "honest",
          [[0, "call"], [0.5, "flip", { n: 0 }], [0.55, "good", { n: 0 }], [0.9, "flip", { n: 1 }], [0.95, "good", { n: 1 }], [1.9, "verdictHonest"], [2.6, "pickup", { n: 5, pan: -0.5 }]],
          [[0, "call"], [1.9, "verdictHonest"]],
        ),
    },
    { name: "Last card warning", run: () => scenario("last card", [[0, "lastCard", { pan: -0.3 }]], [[0, "lastCard"]]) },
    {
      name: "Deal",
      run: () => scenario("deal", [[0, "shuffle"], ...Array.from({ length: 6 }, (_, i): [number, Cue, CueOptions] => [0.6 + i * 0.09, "deal", { n: i }])]),
    },
    { name: "Victory", run: () => scenario("win", [[0, "win"]], [[0, "win"]]) },
    { name: "Defeat", run: () => scenario("lose", [[0, "lose"]], [[0, "lose"]]) },
  ];

  return (
    <div className="lab">
      <style>{css}</style>
      <h1>Audio lab</h1>
      <p className="note">
        Every cue the game can make, plus the beds and haptic patterns. Sliders feed <code>n</code>, <code>level</code>, <code>pan</code> and <code>dur</code>; each cue reads only the ones that mean something to it (see
        src/lib/feel/contract.ts). The first tap unlocks audio.
      </p>

      <div className="panel">
        <div className="row">
          <label><input type="checkbox" checked={p.sound} onChange={(e) => prefs.set({ sound: e.target.checked })} /> Sound</label>
          <label><input type="checkbox" checked={p.haptics} onChange={(e) => prefs.set({ haptics: e.target.checked })} /> Haptics {haptics.supported() ? "(supported here)" : "(not supported on this device)"}</label>
          <label>
            Effects{" "}
            <select value={p.effects} onChange={(e) => prefs.set({ effects: e.target.value as EffectsPref })}>
              <option value="auto">auto (follow system)</option>
              <option value="full">full</option>
              <option value="reduced">reduced</option>
            </select>
          </label>
        </div>
        <div className="grid" style={{ marginTop: 10 }}>
          <div>
            <Slider label="n" value={n} min={0} max={6} step={1} onChange={setN} />
            <Slider label="level" value={level} min={0} max={1} step={0.05} onChange={setLevel} fmt={(v) => v.toFixed(2)} />
          </div>
          <div>
            <Slider label="pan" value={pan} min={-1} max={1} step={0.1} onChange={setPan} fmt={(v) => v.toFixed(1)} />
            <Slider label="dur" value={dur} min={0.1} max={2} step={0.05} onChange={setDur} fmt={(v) => `${v.toFixed(2)}s`} />
            <label style={{ fontSize: 12, color: "#a79cc4" }}><input type="checkbox" checked={useDur} onChange={(e) => setUseDur(e.target.checked)} /> send dur (otherwise each cue uses its own)</label>
          </div>
        </div>
        <div className="log">{last || "—"}</div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="row">
            {g.cues.map((c) => (
              <button key={c} className="cue" onClick={() => fire(c)} title={`target ≈ ${CUES[c].target * 1000} ms`}>
                {c}
              </button>
            ))}
          </div>
        </section>
      ))}

      <h2>Scenarios (cues scheduled on the audio clock)</h2>
      <div className="row">
        {SCENARIOS.map((s) => (
          <button key={s.name} className="cue" onClick={s.run}>{s.name}</button>
        ))}
      </div>

      <h2>Beds</h2>
      <div className="grid">
        <div className="panel">
          <div className="row">
            <button
              className={`cue ${heart ? "on" : ""}`}
              onClick={() => {
                void sfx.unlock();
                const next = !heart;
                setHeart(next);
                sfx.bed("heartbeat", { on: next, bpm, level: beat });
              }}
            >
              heartbeat {heart ? "(on)" : "(off)"}
            </button>
          </div>
          <Slider label="bpm" value={bpm} min={50} max={130} step={1} onChange={(v) => { setBpm(v); sfx.bed("heartbeat", { on: heart, bpm: v, level: beat }); }} />
          <Slider label="level" value={beat} min={0} max={1} step={0.05} onChange={(v) => { setBeat(v); sfx.bed("heartbeat", { on: heart, bpm, level: v }); }} fmt={(v) => v.toFixed(2)} />
          <button className="cue" onClick={() => { setHeart(true); void sfx.unlock(); [60, 70, 80, 90, 100, 110].forEach((b, i) => setTimeout(() => { setBpm(b); sfx.bed("heartbeat", { on: true, bpm: b, level: beat }); }, i * 1200)); }}>
            ramp 60 → 110 bpm
          </button>
        </div>
        <div className="panel">
          <button
            className={`cue ${amb ? "on" : ""}`}
            onClick={() => {
              void sfx.unlock();
              const next = !amb;
              setAmb(next);
              sfx.bed("ambience", { on: next, level: 1 });
            }}
          >
            ambience {amb ? "(on)" : "(off)"}
          </button>
        </div>
      </div>

      <h2>Haptics</h2>
      <p className="note">Needs a phone: Android vibrates through the Vibration API; iOS Safari 17.4+ gets a light tick for the tap-like patterns.</p>
      <div className="row">
        {HAPTICS.map((h) => (
          <button key={h} className="hap" onClick={() => { haptics.play(h, { n, level }); setLast(`haptic ${h} n=${n} level=${level}`); }}>
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}

if (params.get("check")) {
  window.__leeryAudio = api;
  document.title = "audio check";
} else {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
}
