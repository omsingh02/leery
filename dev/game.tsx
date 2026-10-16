/* eslint-disable react-refresh/only-export-components -- a dev harness: components only, nothing to hot-swap */
/**
 * Harness for the in-game screen — no backend needed.
 *   npx vite --config dev/vite.harness.config.ts
 *   /dev/game.html?state=turn-mine      a static fixture (see FIXTURE_NAMES in src/dev/fixtures.ts)
 *   /dev/game.html?sim=1                a scripted game: play cards → bots react → reveal → their turn → …
 *   /dev/game.html?deal=1               a brand-new game: watch the opening deal
 * Add `&reduced=1` (or `&reduced=0`) to switch the "Screen effects" setting to Reduced (or Full) — it is the real setting,
 * so it is remembered by this browser like any other.
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@/index.css";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { FxProvider } from "@/components/fx/FxProvider";
import { GameScreen } from "@/components/game/GameScreen";
import { PlayingCard } from "@/components/game/PlayingCard";
import { fakeController } from "@/dev/fakeController";
import { FIXTURE_NAMES, fixture, type FixtureName } from "@/dev/fixtures";
import { nextRank, rankOf, sortCards } from "@/lib/game";
import { prefs } from "@/lib/prefs";
import { RANKS, SUITS, type CardCode, type LogEntry, type Rank, type RoomView } from "@/lib/types";

const params = new URLSearchParams(window.location.search);
const ME = "p-me";

const SPARE: CardCode[] = ["2C", "4S", "5D", "6H", "8C", "9S", "10C", "JD", "QH", "KS", "AD", "2H", "3S", "5C", "6S", "8H"];

/** A tiny scripted game so transitions (flights, reveal exit, selection pruning, turn alerts) can be watched live. */
function SimApp({ reduced }: { reduced: boolean }) {
  const [view, setView] = useState<RoomView>(() => fixture("turn-mine") as RoomView);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const seq = useRef(100);
  const played = useRef<CardCode[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => void timers.current.push(window.setTimeout(fn, ms));
  const entry = (e: Omit<LogEntry, "n" | "t">): LogEntry => ({ n: ++seq.current, t: Date.now(), ...e });
  const bump = (v: RoomView, patch: Partial<RoomView>): RoomView => ({ ...v, ...patch, v: v.v + 1, now: Date.now() });
  const nameOf = (id: string) => (id === ME ? "Alex" : id === "p-vex" ? "Vex" : "Mira");

  const startMyTurn = (v: RoomView, rank: Rank) =>
    setView(
      bump(v, {
        status: "turn",
        reveal: null,
        challenge: null,
        turn: { player: ME, rank, since: Date.now(), deadline: Date.now() + 30000 },
        due: Date.now() + 30000,
        me: { ...v.me, canPlay: true, canCall: false, canPass: false, passed: false },
      }),
    );

  /** Mira's turn: after a moment she plays two cards, opening a challenge window for me. */
  const startTheirTurn = (v: RoomView, rank: Rank) => {
    setView(
      bump(v, {
        status: "turn",
        reveal: null,
        challenge: null,
        turn: { player: "p-mira", rank, since: Date.now(), deadline: Date.now() + 20000 },
        due: Date.now() + 2500,
        me: { ...v.me, canPlay: false, canCall: false, canPass: false, passed: false },
      }),
    );
    later(2500, () => {
      const cur = viewRef.current;
      setView(
        bump(cur, {
          status: "challenge",
          turn: null,
          pile: cur.pile + 2,
          players: cur.players.map((p) => (p.id === "p-mira" ? { ...p, cards: Math.max(0, p.cards - 2) } : p)),
          challenge: { by: "p-mira", count: 2, rank, since: Date.now(), deadline: Date.now() + 6000, passed: [] },
          due: Date.now() + 6000,
          me: { ...cur.me, canPlay: false, canCall: true, canPass: true, passed: false },
          log: [...cur.log, entry({ k: "play", p: "p-mira", pn: "Mira", c: 2, r: rank })],
        }),
      );
    });
    // nobody calls → back to me with the next rank
    later(8800, () => {
      const cur = viewRef.current;
      if (cur.status === "challenge" && cur.challenge?.by === "p-mira") startMyTurn(cur, nextRank(rank));
    });
  };

  const reveal = (v: RoomView, caller: string, accused: string, cards: CardCode[], rank: Rank) => {
    const bluff = cards.some((c) => rankOf(c) !== rank);
    const picker = bluff ? accused : caller;
    const pickup = v.pile;
    const hand =
      picker === ME ? sortCards([...v.me.hand, ...SPARE.filter((c) => !v.me.hand.includes(c)).slice(0, pickup)]) : v.me.hand;
    setView(
      bump(v, {
        status: "reveal",
        challenge: null,
        pile: 0,
        reveal: { caller, accused, cards, rank, bluff, picker, pickup, winner: null, until: Date.now() + 4200 },
        due: Date.now() + 4200,
        players: v.players.map((p) => (p.id === picker ? { ...p, cards: p.cards + pickup } : p)),
        me: { ...v.me, hand, canCall: false, canPass: false, canPlay: false },
        log: [...v.log, entry({ k: "call", p: caller, pn: nameOf(caller), a: accused, an: nameOf(accused), b: bluff, x: pickup, r: rank })],
      }),
    );
    later(4300, () => {
      const cur = viewRef.current;
      if (cur.status === "reveal") startTheirTurn(cur, nextRank(rank));
    });
  };

  const room = useMemo(
    () =>
      fakeController(view, {
        play: async (cards) => {
          const rank = view.turn?.rank;
          if (!rank) return false;
          played.current = cards;
          setView(
            bump(view, {
              status: "challenge",
              turn: null,
              pile: view.pile + cards.length,
              players: view.players.map((p) => (p.id === ME ? { ...p, cards: p.cards - cards.length } : p)),
              me: { ...view.me, hand: view.me.hand.filter((c) => !cards.includes(c)), canPlay: false },
              challenge: { by: ME, count: cards.length, rank, since: Date.now(), deadline: Date.now() + 5000, passed: [] },
              due: Date.now() + 5000,
              log: [...view.log, entry({ k: "play", p: ME, pn: "Alex", c: cards.length, r: rank })],
            }),
          );
          // Vex (a paranoid bot) calls multi-card plays and obvious lies 1.8s later; otherwise the window just closes
          later(1800, () => {
            const cur = viewRef.current;
            if (cur.status !== "challenge") return;
            if (cards.length >= 2 || cards.some((c) => rankOf(c) !== rank)) reveal(cur, "p-vex", ME, played.current, rank);
          });
          later(5300, () => {
            const cur = viewRef.current;
            if (cur.status === "challenge" && cur.challenge?.by === ME) startTheirTurn(cur, nextRank(rank));
          });
          return true;
        },
        call: async () => {
          const ch = view.challenge;
          if (!ch) return false;
          reveal(view, ME, ch.by, ["4C", "9H"].slice(0, ch.count), ch.rank);
          return true;
        },
        pass: async () => {
          setView(
            bump(view, {
              me: { ...view.me, passed: true, canCall: false, canPass: false },
              challenge: view.challenge && { ...view.challenge, passed: [ME] },
            }),
          );
          return true;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sim intentionally closes over the latest view on every change
    [view],
  );

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <FxProvider>
        <MemoryRouter>
          <GameScreen room={room} />
        </MemoryRouter>
        <Toaster theme="dark" />
      </FxProvider>
    </MotionConfig>
  );
}

/** All 52 cards + back + selected/highlighted states, for eyeballing the card art. */
function GalleryApp() {
  const unit = Number(params.get("unit") ?? 11);
  return (
    <div className="space-y-3 p-4">
      {SUITS.map((suit) => (
        <div key={suit} className="flex flex-wrap gap-2">
          {RANKS.map((rank) => (
            <PlayingCard key={rank + suit} code={`${rank}${suit}` as CardCode} unit={unit} />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3 pt-3">
        <PlayingCard faceDown unit={unit} />
        <PlayingCard faceDown unit={6} />
        <PlayingCard faceDown unit={4} />
        <PlayingCard code="7H" unit={unit} onClick={() => undefined} selected />
        <PlayingCard code="QS" unit={unit} onClick={() => undefined} highlighted />
        <PlayingCard code="10D" unit={unit} onClick={() => undefined} highlighted selected />
        <PlayingCard code="KC" unit={unit} onClick={() => undefined} disabled />
      </div>
    </div>
  );
}

const requested = params.get("state") ?? "turn-mine";
const name: FixtureName = (FIXTURE_NAMES as readonly string[]).includes(requested) ? (requested as FixtureName) : "turn-mine";
const reducedParam = params.get("reduced");
if (reducedParam !== null) prefs.set({ effects: reducedParam === "1" ? "reduced" : "full" });
const reduced = reducedParam === "1";

/** A game that has just started: nothing played yet, 13 cards each — the director deals them out. */
function freshDeal(): RoomView {
  const v = fixture("turn-mine") as RoomView;
  const hand = sortCards(["AS", "3H", "3D", "5C", "7S", "7H", "9C", "10D", "JH", "JS", "QC", "KD", "KH"]);
  return {
    ...v,
    pile: 0,
    log: [{ n: 1, t: Date.now(), k: "start" }],
    players: v.players.map((p) => ({ ...p, cards: 13 })),
    me: { ...v.me, hand, canPlay: true },
  };
}

function StaticApp() {
  const room = useMemo(
    () =>
      fakeController(params.get("deal") ? freshDeal() : fixture(name), {
        play: async (cards) => {
          console.info("[harness] play", cards);
          return true;
        },
      }),
    [],
  );
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <FxProvider>
        <MemoryRouter>
          <GameScreen room={room} />
        </MemoryRouter>
        <Toaster theme="dark" />
      </FxProvider>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>{params.get("gallery") ? <GalleryApp /> : params.get("sim") ? <SimApp reduced={reduced} /> : <StaticApp />}</StrictMode>,
);
