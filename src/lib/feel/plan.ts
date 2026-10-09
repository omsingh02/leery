import type { BurstOptions, Cue, CueOptions, HapticName, HapticOptions, Point, RingOptions, BurstKind } from "./contract";

/**
 * Every game-feel moment, as one semantic event. `plan()` turns an event into what the player should
 * hear, feel and see — as plain data, so the whole mapping is unit-testable and the three channels
 * (audio, haptics, visual FX) can never drift apart.
 */
export type FeelEvent =
  // chrome
  | { type: "ui.tap" }
  | { type: "ui.toggle"; on: boolean }
  | { type: "ui.error" }
  | { type: "ui.copy" }
  | { type: "lobby.join" }
  | { type: "lobby.leave" }
  // my hand
  | { type: "card.select"; n: number }
  | { type: "card.deselect"; n: number }
  | { type: "card.limit" }
  | { type: "card.wave"; n: number }
  | { type: "drag.arm" }
  | { type: "drag.disarm" }
  // cards in the air
  | { type: "cards.throw"; n: number; mine: boolean; pan?: number; dur?: number }
  | { type: "cards.land"; n: number; mine: boolean; at?: Point; pan?: number }
  // turns and time
  | { type: "turn.mine" }
  | { type: "turn.other"; pan?: number }
  | { type: "timer.tick"; seconds: number; urgency: number; pan?: number }
  | { type: "timer.out" }
  // the challenge
  | { type: "accept.mine" }
  | { type: "accept.other"; pan?: number }
  | { type: "call"; mine: boolean; at?: Point; pan?: number }
  // the reveal
  | { type: "reveal.drumroll"; dur: number }
  | { type: "reveal.flip"; i: number; ok: boolean; at?: Point }
  | { type: "reveal.verdict"; bluff: boolean; at?: Point }
  | { type: "pickup.sweep"; n: number; dur: number; pan?: number }
  | { type: "pickup.land"; n: number; at?: Point; pan?: number; mine: boolean; bluff: boolean }
  | { type: "count.tick"; step: number; pan?: number }
  | { type: "lastCard"; at?: Point; pan?: number }
  // start and end
  | { type: "deal.shuffle" }
  | { type: "deal.wave"; i: number; pan?: number }
  | { type: "game.win"; at?: Point }
  | { type: "game.lose" };

export type FxStep =
  | { fx: "shake"; intensity: number; durationMs?: number }
  | { fx: "flash"; color: string; peak?: number; durationMs?: number }
  | { fx: "burst"; kind: BurstKind; at: Point; opts?: BurstOptions }
  | { fx: "ring"; at: Point; opts?: RingOptions };

export interface Plan {
  cues: [Cue, CueOptions?][];
  haptic?: [HapticName, HapticOptions?];
  fx: FxStep[];
}

/** The palette, as CSS colours the canvas and overlays understand. */
export const COLOR = {
  violet: "#8b5cf6",
  pink: "#ec4899",
  bluff: "hsl(348 100% 62%)",
  trust: "hsl(166 84% 50%)",
  gold: "hsl(44 97% 58%)",
  ivory: "#f4efe4",
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pan = (p: number | undefined): CueOptions => (p === undefined ? {} : { pan: Math.max(-1, Math.min(1, p)) });

/** What an event sounds like, feels like and looks like. Pure. */
export function plan(e: FeelEvent): Plan {
  const none: Plan = { cues: [], fx: [] };
  switch (e.type) {
    case "ui.tap":
      return { cues: [["tap"]], fx: [] };
    case "ui.toggle":
      return { cues: [["toggle", { level: e.on ? 1 : 0 }]], haptic: ["tap"], fx: [] };
    case "ui.error":
      return { cues: [["error"]], haptic: ["error"], fx: [] };
    case "ui.copy":
      return { cues: [["copy"]], haptic: ["tap"], fx: [] };
    case "lobby.join":
      return { cues: [["join"]], haptic: ["tap"], fx: [] };
    case "lobby.leave":
      return { cues: [["leave"]], fx: [] };

    case "card.select":
      return { cues: [["select", { n: e.n }]], haptic: ["select"], fx: [] };
    case "card.deselect":
      return { cues: [["deselect", { n: e.n }]], haptic: ["deselect"], fx: [] };
    case "card.limit":
      return { cues: [["limit"]], haptic: ["limit"], fx: [] };
    case "card.wave":
      return { cues: [["wave", { n: e.n }]], haptic: ["select"], fx: [] };
    case "drag.arm":
      return { cues: [["wave", { n: 2 }]], haptic: ["select"], fx: [] };
    case "drag.disarm":
      return { cues: [["deselect", { n: 1 }]], haptic: ["deselect"], fx: [] };

    case "cards.throw":
      return { cues: [["whoosh", { n: e.n, dur: e.dur, ...pan(e.pan) }]], haptic: e.mine ? ["play", { n: e.n }] : undefined, fx: [] };
    case "cards.land": {
      const n = Math.max(1, Math.min(4, e.n));
      const level = clamp01(0.35 + 0.2 * n);
      const fx: FxStep[] = [];
      if (e.at) {
        fx.push({ fx: "ring", at: e.at, opts: { color: COLOR.ivory, size: 46 + 12 * n, duration: 380, width: 2 } });
        fx.push({ fx: "burst", kind: "dust", at: e.at, opts: { count: 4 + 3 * n, power: 0.45 + 0.1 * n, spread: 360, color: COLOR.ivory } });
      }
      if (n >= 2) fx.push({ fx: "shake", intensity: 0.07 * n, durationMs: 180 });
      return { cues: [["land", { n, level, ...pan(e.pan) }]], haptic: e.mine ? ["land", { n }] : undefined, fx };
    }

    case "turn.mine":
      return { cues: [["turn"]], haptic: ["turn"], fx: [{ fx: "flash", color: COLOR.gold, peak: 0.08, durationMs: 420 }] };
    case "turn.other":
      return { cues: [["turnOther", pan(e.pan)]], fx: [] };
    case "timer.tick":
      return { cues: [["tick", { n: e.seconds, level: clamp01(e.urgency), ...pan(e.pan) }]], haptic: e.urgency >= 0.5 ? ["tick"] : undefined, fx: [] };
    case "timer.out":
      return { cues: [["buzzer"]], haptic: ["error"], fx: [{ fx: "shake", intensity: 0.25, durationMs: 220 }] };

    case "accept.mine":
      return { cues: [["accept"]], haptic: ["accept"], fx: [] };
    case "accept.other":
      return { cues: [["acceptOther", pan(e.pan)]], fx: [] };

    case "call": {
      const strong = e.mine ? 1 : 0.8;
      const fx: FxStep[] = [
        { fx: "shake", intensity: 0.7 * strong, durationMs: 340 },
        { fx: "flash", color: COLOR.bluff, peak: 0.26 * strong, durationMs: 300 },
      ];
      if (e.at) {
        fx.push({ fx: "ring", at: e.at, opts: { color: COLOR.bluff, size: 190, duration: 520, width: 3 } });
        fx.push({ fx: "burst", kind: "sparks", at: e.at, opts: { count: 22, power: 0.8, spread: 360, color: [COLOR.bluff, COLOR.pink, COLOR.ivory] } });
      }
      return { cues: [["call", { level: strong, ...pan(e.pan) }]], haptic: ["call"], fx };
    }

    case "reveal.drumroll":
      return { cues: [["drumroll", { dur: e.dur }]], fx: [] };
    case "reveal.flip": {
      const cue: Cue = e.ok ? "good" : "badCard";
      const fx: FxStep[] = [];
      if (e.at) {
        fx.push(
          e.ok
            ? { fx: "burst", kind: "glints", at: e.at, opts: { count: 5, power: 0.35, spread: 360, color: [COLOR.trust, COLOR.ivory] } }
            : { fx: "burst", kind: "sparks", at: e.at, opts: { count: 9, power: 0.55, spread: 360, color: [COLOR.bluff, COLOR.pink] } },
        );
      }
      return { cues: [["flip", { n: e.i }], [cue, { n: e.i, delay: 0.06 }]], haptic: ["flip"], fx };
    }
    case "reveal.verdict": {
      if (e.bluff) {
        const fx: FxStep[] = [
          { fx: "shake", intensity: 0.95, durationMs: 420 },
          { fx: "flash", color: COLOR.bluff, peak: 0.34, durationMs: 420 },
        ];
        if (e.at) {
          fx.push({ fx: "ring", at: e.at, opts: { color: COLOR.bluff, size: 260, duration: 640, width: 3 } });
          fx.push({ fx: "burst", kind: "sparks", at: e.at, opts: { count: 34, power: 0.95, spread: 360, color: [COLOR.bluff, COLOR.pink, COLOR.gold] } });
          fx.push({ fx: "burst", kind: "embers", at: e.at, opts: { count: 14, power: 0.4, spread: 140, angle: -90, color: [COLOR.bluff, COLOR.gold] } });
        }
        return { cues: [["verdictBluff"]], haptic: ["verdictBluff"], fx };
      }
      const fx: FxStep[] = [{ fx: "flash", color: COLOR.trust, peak: 0.2, durationMs: 420 }];
      if (e.at) {
        fx.push({ fx: "ring", at: e.at, opts: { color: COLOR.trust, size: 230, duration: 640, width: 2.5 } });
        fx.push({ fx: "burst", kind: "glints", at: e.at, opts: { count: 16, power: 0.5, spread: 360, color: [COLOR.trust, COLOR.gold, COLOR.ivory] } });
      }
      return { cues: [["verdictHonest"]], haptic: ["verdictHonest"], fx };
    }

    case "pickup.sweep":
      return { cues: [["pickup", { n: e.n, dur: e.dur, ...pan(e.pan) }]], fx: [] };
    case "pickup.land": {
      const fx: FxStep[] = [];
      if (e.at) {
        fx.push({ fx: "ring", at: e.at, opts: { color: e.bluff ? COLOR.bluff : COLOR.gold, size: 70, duration: 420, width: 2.5 } });
        fx.push({ fx: "burst", kind: "dust", at: e.at, opts: { count: 8, power: 0.5, spread: 360, color: COLOR.ivory } });
      }
      if (e.mine) fx.push({ fx: "shake", intensity: e.bluff ? 0.2 : 0.35, durationMs: 220 });
      return { cues: [["land", { n: Math.min(4, e.n), level: 0.5, ...pan(e.pan) }]], haptic: e.mine ? ["pickup", { n: e.n }] : undefined, fx };
    }
    case "count.tick":
      return { cues: [["cardTick", { n: e.step, ...pan(e.pan) }]], fx: [] };
    case "lastCard": {
      const fx: FxStep[] = [];
      if (e.at) {
        fx.push({ fx: "ring", at: e.at, opts: { color: COLOR.bluff, size: 64, duration: 700, width: 2.5 } });
        fx.push({ fx: "burst", kind: "sparks", at: e.at, opts: { count: 10, power: 0.45, spread: 360, color: [COLOR.bluff, COLOR.gold] } });
      }
      return { cues: [["lastCard", pan(e.pan)]], haptic: ["lastCard"], fx };
    }

    case "deal.shuffle":
      return { cues: [["shuffle"]], fx: [] };
    case "deal.wave":
      return { cues: [["deal", { n: e.i, ...pan(e.pan) }]], fx: [] };

    case "game.win": {
      const fx: FxStep[] = [
        { fx: "flash", color: COLOR.gold, peak: 0.22, durationMs: 600 },
        { fx: "shake", intensity: 0.3, durationMs: 260 },
      ];
      if (e.at) {
        fx.push({ fx: "burst", kind: "confetti", at: e.at, opts: { count: 70, power: 0.9, spread: 120, angle: -90 } });
        fx.push({ fx: "burst", kind: "glints", at: e.at, opts: { count: 18, power: 0.6, spread: 360, color: [COLOR.gold, COLOR.ivory] } });
      }
      return { cues: [["win"]], haptic: ["win"], fx };
    }
    case "game.lose":
      return { cues: [["lose"]], haptic: ["lose"], fx: [] };
    default: {
      // Adding a FeelEvent without deciding how it looks, sounds and feels is a compile error, not silence.
      const unhandled: never = e;
      void unhandled;
      return none;
    }
  }
}
