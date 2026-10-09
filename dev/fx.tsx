/* eslint-disable react-refresh/only-export-components -- a dev harness: components only, nothing to hot-swap */
/**
 * FX lab — every effect, every knob. No backend.
 *   npm run dev:ui  →  /dev/fx.html
 * Click or tap anywhere on the table to fire the selected effect at that point.
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@/index.css";
import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { FxProvider } from "@/components/fx/FxProvider";
import type { BurstKind, BurstOptions, FxController } from "@/lib/feel/contract";
import { getFxDebug, PALETTE, shakeStyle, useFx } from "@/lib/fx";
import { prefs, usePrefs, type EffectsPref } from "@/lib/prefs";

type Kind = BurstKind | "ring";
const KINDS: Kind[] = ["sparks", "dust", "embers", "confetti", "smoke", "glints", "ring"];
const BRAND_MIX = [PALETTE.violet, PALETTE.pink, PALETTE.gold, PALETTE.mint, PALETTE.red, PALETTE.ivory];
const COLORS: { name: string; value: string | string[] | undefined }[] = [
  { name: "auto", value: undefined },
  { name: "violet", value: PALETTE.violet },
  { name: "pink", value: PALETTE.pink },
  { name: "red", value: PALETTE.red },
  { name: "mint", value: PALETTE.mint },
  { name: "gold", value: PALETTE.gold },
  { name: "ivory", value: PALETTE.ivory },
  { name: "mix", value: BRAND_MIX },
];
const VIGNETTE_COLORS = [
  { name: "tense red", value: undefined },
  { name: "violet", value: "hsl(265 80% 30%)" },
  { name: "gold", value: "hsl(44 90% 40%)" },
];

declare global {
  interface Window {
    /** The live controller, for driving the lab from automated checks. */
    __fx?: FxController;
    /** The engine's live counters (particles, loop running…). */
    __fxDebug?: typeof getFxDebug;
  }
}

/** `?perf=1`: no HUD polling, so frame-time measurements from outside aren't skewed by the lab itself. */
const PERF_MODE = new URLSearchParams(window.location.search).get("perf") === "1";

const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.34 });

function Slider(p: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="lab-slider">
      {p.label}
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <output>{p.fmt ? p.fmt(p.value) : p.value}</output>
    </label>
  );
}

function Btn(p: { children: React.ReactNode; onClick: () => void; on?: boolean; tone?: string }) {
  return (
    <button type="button" className={`lab-btn ${p.tone ?? ""}`} data-on={p.on ? "true" : undefined} onClick={p.onClick}>
      {p.children}
    </button>
  );
}

/** Frame-time readout from our own rAF sampler, plus the engine's live counters. */
function useStats(enabled: boolean) {
  const [s, setS] = useState({ alive: 0, max: 0, rings: 0, pending: 0, running: false, shaking: false, reduced: false, avg: 0, p95: 0, worst: 0, fps: 0 });
  useEffect(() => {
    if (!enabled) return; // ?perf=1 keeps the page quiet so external measurements aren't skewed
    const deltas: number[] = [];
    let last = performance.now();
    let id = 0;
    const loop = (ts: number) => {
      deltas.push(ts - last);
      last = ts;
      if (deltas.length > 240) deltas.shift();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const timer = setInterval(() => {
      const d = getFxDebug();
      const sorted = [...deltas].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
      setS({
        alive: d?.alive ?? 0,
        max: d?.max ?? 0,
        rings: d?.rings ?? 0,
        pending: d?.pending ?? 0,
        running: d?.running ?? false,
        shaking: d?.shaking ?? false,
        reduced: d?.reduced ?? false,
        avg,
        p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
        worst: sorted.length ? sorted[sorted.length - 1] : 0,
        fps: avg ? 1000 / avg : 0,
      });
    }, 250);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(timer);
    };
  }, [enabled]);
  return s;
}

function Lab() {
  const fx = useFx();
  const { effects } = usePrefs();
  const stats = useStats(!PERF_MODE);
  useEffect(() => {
    window.__fx = fx;
    window.__fxDebug = getFxDebug;
    return () => {
      delete window.__fx;
      delete window.__fxDebug;
    };
  }, [fx]);

  const [kind, setKind] = useState<Kind>("sparks");
  const [countAuto, setCountAuto] = useState(true);
  const [count, setCount] = useState(24);
  const [power, setPower] = useState(0.55);
  const [spreadAuto, setSpreadAuto] = useState(true);
  const [spread, setSpread] = useState(360);
  const [angle, setAngle] = useState(-90);
  const [delay, setDelay] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const [ringToo, setRingToo] = useState(false);
  const [vig, setVig] = useState(0);
  const [vigColor, setVigColor] = useState(0);
  const [beating, setBeating] = useState(false);
  const [open, setOpen] = useState(true);

  const optsFor = useCallback(
    (): BurstOptions => ({
      count: countAuto ? undefined : count,
      power,
      spread: spreadAuto ? undefined : spread,
      angle,
      delay: delay || undefined,
      color: COLORS[colorIdx].value,
    }),
    [countAuto, count, power, spreadAuto, spread, angle, delay, colorIdx],
  );

  const fire = useCallback(
    (x: number, y: number) => {
      if (kind === "ring") {
        const c = COLORS[colorIdx].value;
        fx.ring({ x, y }, { color: Array.isArray(c) ? c[0] : c, size: 40 + power * 160, delay: delay || undefined });
      } else {
        fx.burst(kind, { x, y }, optsFor());
        if (ringToo) fx.ring({ x, y }, { size: 40 + power * 120, delay: delay || undefined });
      }
    },
    [fx, kind, optsFor, ringToo, colorIdx, power, delay],
  );

  // vignette follows its slider; the "heartbeat" button pulses it like the challenge window will
  useEffect(() => {
    if (!beating) {
      fx.vignette(vig, VIGNETTE_COLORS[vigColor].value);
      return;
    }
    let hi = false;
    const id = setInterval(() => {
      hi = !hi;
      fx.vignette(hi ? Math.max(vig, 0.9) : Math.max(0.25, vig * 0.5), VIGNETTE_COLORS[vigColor].value);
    }, 500);
    return () => clearInterval(id);
  }, [fx, vig, vigColor, beating]);

  /* ------------------------------------------------------------------------- recipes */
  const scenes: { name: string; run: () => void }[] = [
    {
      name: "card lands",
      run: () => {
        const c = center();
        fx.burst("dust", c, { count: 6, power: 0.4 });
        fx.ring(c, { size: 64, duration: 420, width: 1.5 });
        fx.shake(0.2, 180);
      },
    },
    {
      name: "bluff called",
      run: () => {
        const c = center();
        fx.shake(0.7, 380);
        fx.flash(PALETTE.red, 0.38, 240);
        fx.ring(c, { color: PALETTE.red, size: 170, duration: 620, width: 3 });
        fx.burst("sparks", c, { count: 22, power: 0.8, color: [PALETTE.red, PALETTE.ivory, PALETTE.gold] });
      },
    },
    {
      name: "BLUFF!",
      run: () => {
        const c = center();
        fx.shake(0.95, 480);
        fx.flash(PALETTE.red, 0.5, 280);
        fx.ring(c, { color: PALETTE.red, size: 210, duration: 700, width: 3 });
        fx.ring(c, { color: PALETTE.ivory, size: 120, duration: 520, width: 1.5, delay: 0.08 });
        fx.burst("sparks", c, { count: 34, power: 0.95, color: [PALETTE.red, PALETTE.pink, PALETTE.ivory] });
        fx.burst("smoke", c, { count: 4, power: 0.3 });
      },
    },
    {
      name: "HONEST",
      run: () => {
        const c = center();
        fx.flash(PALETTE.mint, 0.3, 320);
        fx.ring(c, { color: PALETTE.mint, size: 150, duration: 640, width: 2.5 });
        fx.burst("glints", c, { count: 9, power: 0.7, color: [PALETTE.mint, PALETTE.ivory] });
        fx.burst("embers", c, { count: 12, power: 0.5, color: [PALETTE.mint, PALETTE.ivory], spread: 160 });
      },
    },
    {
      name: "pile pick-up",
      run: () => {
        const to = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.1 };
        fx.burst("dust", to, { count: 8, power: 0.5 });
        fx.ring(to, { color: PALETTE.gold, size: 70, duration: 480 });
        fx.burst("sparks", to, { count: 10, power: 0.45, color: [PALETTE.gold, PALETTE.ivory], spread: 220, angle: 90 });
        fx.shake(0.28, 220);
      },
    },
    {
      name: "victory",
      run: () => {
        const y = window.innerHeight * 0.3;
        const w = window.innerWidth;
        fx.flash(PALETTE.gold, 0.22, 420);
        fx.burst("confetti", { x: w * 0.2, y }, { count: 60, angle: -60, spread: 70, power: 0.9 });
        fx.burst("confetti", { x: w * 0.8, y }, { count: 60, angle: -120, spread: 70, power: 0.9 });
        fx.burst("confetti", { x: w * 0.5, y: y + 20 }, { count: 70, angle: -90, spread: 90, power: 1 });
        fx.burst("glints", { x: w * 0.5, y: y - 20 }, { count: 14, power: 1, color: [PALETTE.gold, PALETTE.ivory] });
        fx.ring({ x: w * 0.5, y }, { color: PALETTE.gold, size: 240, duration: 900, width: 3 });
        fx.burst("embers", { x: w * 0.5, y: y + 60 }, { count: 24, power: 0.8, spread: 140, color: [PALETTE.gold, PALETTE.pink] });
      },
    },
  ];

  const stress = () => {
    // ≈1000 requested particles inside 250 ms — far above the cap, to watch it hold
    const kinds: BurstKind[] = ["confetti", "sparks", "embers", "dust", "smoke", "glints"];
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        const k = kinds[i % kinds.length];
        fx.burst(k, { x: 40 + Math.random() * (window.innerWidth - 80), y: 80 + Math.random() * window.innerHeight * 0.5 }, { count: 160, power: 0.9 });
      }, i * 20);
    }
  };

  // ?stress=1 runs the stress test shortly after load (handy for automated checks)
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || new URLSearchParams(window.location.search).get("stress") !== "1") return;
    auto.current = true;
    const id = setTimeout(stress, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load
  }, []);

  const stageStyle: CSSProperties = { ...shakeStyle };
  return (
    <>
      <div className="lab-hud" data-testid="lab-hud">
        <span className="lab-title">FX lab</span>
        <span>particles <b data-testid="stat-alive">{stats.alive}</b>/{stats.max}</span>
        <span>rings <b>{stats.rings}</b></span>
        <span>pending <b>{stats.pending}</b></span>
        <span>loop <b data-testid="stat-running">{stats.running ? "running" : "idle"}</b></span>
        <span>shake <b>{stats.shaking ? "on" : "off"}</b></span>
        <span>frame avg <b>{stats.avg.toFixed(1)}</b> · p95 <b>{stats.p95.toFixed(1)}</b> · worst <b>{stats.worst.toFixed(0)}</b> ms ({stats.fps.toFixed(0)} fps)</span>
        <span>effects <b>{stats.reduced ? "REDUCED" : "full"}</b></span>
      </div>

      <div className="lab-stage" style={stageStyle} data-testid="lab-stage" onPointerDown={(e) => fire(e.clientX, e.clientY)}>
        <div className="lab-felt" />
        <div className="lab-demo" />
        <div className="lab-hint">tap the table to fire “{kind}”</div>
      </div>

      <div className="lab-panel" data-testid="lab-panel">
        <div className="lab-row">
          <Btn onClick={() => setOpen((o) => !o)}>{open ? "▾ controls" : "▸ controls"}</Btn>
          {scenes.map((s) => (
            <Btn key={s.name} tone="violet" onClick={s.run}>{s.name}</Btn>
          ))}
          <Btn tone="gold" onClick={stress}>stress ≈1000</Btn>
        </div>
        {open && (
          <>
            <div className="lab-row">
              <span className="k">effect</span>
              {KINDS.map((k) => (
                <Btn key={k} on={kind === k} onClick={() => setKind(k)}>{k}</Btn>
              ))}
              <Btn on={ringToo} onClick={() => setRingToo((v) => !v)}>+ ring</Btn>
            </div>
            <div className="lab-row">
              <span className="k">colour</span>
              {COLORS.map((c, i) => (
                <Btn key={c.name} on={colorIdx === i} onClick={() => setColorIdx(i)}>{c.name}</Btn>
              ))}
            </div>
            <div className="lab-row">
              <span className="k">shape</span>
              <Slider label="count" min={1} max={160} step={1} value={count} onChange={(v) => { setCount(v); setCountAuto(false); }} fmt={(v) => (countAuto ? "auto" : String(v))} />
              <Btn on={countAuto} onClick={() => setCountAuto((v) => !v)}>auto</Btn>
              <Slider label="power" min={0} max={1} step={0.05} value={power} onChange={setPower} fmt={(v) => v.toFixed(2)} />
              <Slider label="spread" min={0} max={360} step={5} value={spread} onChange={(v) => { setSpread(v); setSpreadAuto(false); }} fmt={(v) => (spreadAuto ? "auto" : `${v}°`)} />
              <Btn on={spreadAuto} onClick={() => setSpreadAuto((v) => !v)}>auto</Btn>
              <Slider label="angle" min={-180} max={180} step={5} value={angle} onChange={setAngle} fmt={(v) => `${v}°`} />
              <Slider label="delay" min={0} max={1.5} step={0.05} value={delay} onChange={setDelay} fmt={(v) => `${v.toFixed(2)}s`} />
            </div>
            <div className="lab-row">
              <span className="k">screen</span>
              <Btn tone="red" onClick={() => fx.flash(PALETTE.red, 0.4)}>flash red</Btn>
              <Btn tone="mint" onClick={() => fx.flash(PALETTE.mint, 0.35)}>flash mint</Btn>
              <Btn tone="gold" onClick={() => fx.flash(PALETTE.gold, 0.35)}>flash gold</Btn>
              <Btn tone="violet" onClick={() => fx.flash(PALETTE.violet, 0.35)}>flash violet</Btn>
              <Btn onClick={() => fx.shake(0.25)}>shake .25</Btn>
              <Btn onClick={() => fx.shake(0.55)}>shake .55</Btn>
              <Btn onClick={() => fx.shake(1, 500)}>shake 1.0</Btn>
              <Btn onClick={() => { fx.shake(0.4); fx.shake(0.4, 120); }}>shake ×2 (accumulate)</Btn>
            </div>
            <div className="lab-row">
              <span className="k">vignette</span>
              <Slider label="level" min={0} max={1} step={0.05} value={vig} onChange={setVig} fmt={(v) => v.toFixed(2)} />
              {VIGNETTE_COLORS.map((c, i) => (
                <Btn key={c.name} on={vigColor === i} onClick={() => setVigColor(i)}>{c.name}</Btn>
              ))}
              <Btn on={beating} onClick={() => setBeating((v) => !v)}>heartbeat pulse</Btn>
            </div>
            <div className="lab-row">
              <span className="k">effects</span>
              {(["auto", "full", "reduced"] as EffectsPref[]).map((e) => (
                <Btn key={e} on={effects === e} onClick={() => prefs.set({ effects: e })}>{e}</Btn>
              ))}
              <span style={{ fontSize: 11, color: "#a79fc4" }}>“reduced” turns shake, flashes and particles off and caps the vignette at 0.35</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <FxProvider>
      <Lab />
    </FxProvider>
  </StrictMode>,
);
