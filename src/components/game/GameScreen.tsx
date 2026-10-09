import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Check, Copy, Ellipsis, HelpCircle, LogOut, ScrollText, Settings, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Hint } from "@/components/shell/Hint";
import { RulesDialog } from "@/components/shell/RulesDialog";
import { SettingsDialog } from "@/components/shell/SettingsDialog";
import { SoundToggle } from "@/components/shell/SoundToggle";
import type { RoomController } from "@/hooks/useRoom";
import { describeLog, RANK_PLURAL } from "@/lib/game";
import { shakeStyle } from "@/lib/fx";
import { hints, useHint } from "@/lib/hints";
import type { CardCode, RoomView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActionBar } from "./ActionBar";
import { FlyLayer, type Point } from "./FlyLayer";
import { GameLog } from "./GameLog";
import { Hand, type DragState } from "./Hand";
import { MyBar } from "./MyBar";
import { myNextTurn } from "./myNext";
import { RevealOverlay } from "./RevealOverlay";
import { Table } from "./Table";
import { useDirector } from "./director/useDirector";
import { useMediaQuery } from "./useMediaQuery";
import "./game.css";

const PLAYABLE = new Set(["turn", "challenge", "reveal"]);

/** Has this first-time tip already been shown? (Read once, when deciding whether to chain the next one.) */
const hintsSeen = (id: Parameters<typeof hints.has>[0]) => hints.has(id);

function centerOf(el: Element | null | undefined, topBias = false): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: topBias ? r.top + Math.min(40, r.height / 2) : r.top + r.height / 2 };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const headerButton =
  "grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground";

/** ⋯ menu: a tiny accessible popover (Esc / outside click closes). */
function HeaderMenu({ onRules, onSettings, onLeave }: { onRules: () => void; onSettings: () => void; onLeave: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-white/10 focus-visible:bg-white/10";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        data-testid="game-menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={headerButton}
      >
        <Ellipsis className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="glass-strong absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl p-1.5 shadow-2xl animate-in fade-in-0 zoom-in-95"
        >
          <button
            role="menuitem"
            type="button"
            data-testid="menu-rules"
            className={item}
            onClick={() => {
              setOpen(false);
              onRules();
            }}
          >
            <HelpCircle className="h-4 w-4 text-primary" aria-hidden /> How to play
          </button>
          <button
            role="menuitem"
            type="button"
            data-testid="menu-settings"
            className={item}
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <Settings className="h-4 w-4 text-primary" aria-hidden /> Settings
          </button>
          <button
            role="menuitem"
            type="button"
            data-testid="leave-game-menu"
            className={cn(item, "text-rose-300")}
            onClick={() => {
              setOpen(false);
              onLeave();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Leave game
          </button>
        </div>
      )}
    </div>
  );
}

function GameScreenInner({ room, view }: { room: RoomController; view: RoomView }) {
  const navigate = useNavigate();
  const { me } = view;
  const short = useMediaQuery("(max-height: 700px)");

  const [selected, setSelected] = useState<CardCode[]>([]);
  const [limitHits, setLimitHits] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragState, setDragState] = useState<DragState>("idle");

  const pileRef = useRef<HTMLDivElement>(null);
  const handWrapRef = useRef<HTMLDivElement>(null);
  const myBarRef = useRef<HTMLDivElement>(null);
  const seatEls = useRef(new Map<string, HTMLElement>());
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const registerSeat = useCallback((id: string, el: HTMLElement | null) => {
    if (el) seatEls.current.set(id, el);
    else seatEls.current.delete(id);
  }, []);

  // The director stages everything that happens at the table; `shown` is the room as it should look right now.
  const d = useDirector({ room, view, refs: { pile: pileRef, handWrap: handWrapRef, seats: seatEls, myBar: myBarRef } });
  const shown = d.shown;

  // ---- selection (lives here so it survives phase changes; pruned against the real hand) -------------
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((c) => me.hand.includes(c));
      return next.length === prev.length ? prev : next;
    });
  }, [me.hand]);

  const toggleCard = useCallback((code: CardCode) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }, []);
  const onLimit = useCallback(() => setLimitHits((h) => h + 1), []);

  /** Play: the cards leave the hand at once (the director flies them), the request follows. */
  const play = useCallback(
    (cards: CardCode[]) => {
      if (cards.length === 0) return;
      setSelected([]);
      void d.playCards(cards);
    },
    [d],
  );

  const myTurn = view.status === "turn" && view.turn?.player === me.id;

  // ---- first-time tips (each shows once, only when it helps) ---------------------------------------------------
  const selectTip = useHint("select", myTurn && me.canPlay && selected.length === 0 && !d.dealing);
  const callTip = useHint("call", view.status === "challenge" && me.canCall && !me.passed);
  const dragTip = useHint("drag", myTurn && me.canPlay && selected.length > 0 && hintsSeen("select"));
  useEffect(() => {
    if (selected.length > 0) selectTip.done();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mark once something is selected
  }, [selected.length]);
  const stageCall = useCallback(
    async (fn: () => Promise<boolean>) => {
      callTip.done();
      return fn();
    },
    [callTip],
  );

  useEffect(() => {
    const previous = document.title;
    document.title = myTurn ? "▶ Your turn · Leery" : `Leery · ${view.code}`;
    return () => {
      document.title = previous;
    };
  }, [myTurn, view.code]);

  // ---- header actions ----------------------------------------------------------------------------------
  const copyInvite = async () => {
    const ok = await copyText(`${window.location.origin}/r/${view.code}`);
    if (!ok) return;
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const confirmLeave = async () => {
    setLeaving(true);
    const ok = await room.leave();
    setLeaving(false);
    if (ok) navigate("/");
  };

  const next = myNextTurn(shown);
  const latestLog = view.log.length ? view.log[view.log.length - 1] : null;
  const visibleHand = useMemo(() => (d.hiding.size ? shown.me.hand.filter((c) => !d.hiding.has(c)) : shown.me.hand), [shown.me.hand, d.hiding]);
  const canDrag = view.status === "turn" && me.canPlay && view.turn?.player === me.id;
  const claimRank = view.turn?.rank;
  const dragLabel = `${Math.max(1, selected.length)} as ${claimRank ? RANK_PLURAL[claimRank] : "the rank"}`;
  const pileFrom: Point | null = centerOf(pileRef.current);

  return (
    <div data-testid="game-screen" style={shakeStyle} className="relative mx-auto flex h-dvh min-h-[520px] w-full flex-col overflow-hidden">
      <header className="safe-pt relative z-40 flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-1 lg:px-6">
        <button
          type="button"
          data-testid="game-room-code"
          onClick={() => void copyInvite()}
          aria-label={`Room ${view.code}. Copy invite link`}
          className="glass flex h-9 items-center gap-2 rounded-full pl-3.5 pr-3 text-sm transition-colors hover:bg-white/10"
        >
          <span className="font-display text-[13px] font-bold tracking-[0.2em]">{view.code}</span>
          {copied ? <Check className="h-3.5 w-3.5 text-trust" aria-hidden /> : <Copy className="h-3.5 w-3.5 text-muted" aria-hidden />}
          <span className="sr-only">{copied ? "Invite link copied" : ""}</span>
        </button>
        {room.connection === "offline" && (
          <span
            role="status"
            data-testid="offline-pill"
            className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300"
          >
            <WifiOff className="h-3 w-3" aria-hidden /> Reconnecting…
          </span>
        )}
        <div className="ml-auto flex items-center">
          <SoundToggle />
          <button type="button" data-testid="game-log-toggle" aria-label="Game log" onClick={() => setLogOpen(true)} className={headerButton}>
            <ScrollText className="h-5 w-5" aria-hidden />
          </button>
          <HeaderMenu onRules={() => setRulesOpen(true)} onSettings={() => setSettingsOpen(true)} onLeave={() => setLeaveOpen(true)} />
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col">
        <Table
          view={shown}
          serverNow={room.serverNow}
          pileRef={pileRef}
          registerSeat={registerSeat}
          pileImpact={d.pileImpact}
          dropActive={dragState === "armed"}
          reactions={d.reactions}
          onCountStep={d.onCountStep}
          quietCounts={d.dealing}
        >
          <div className="shrink-0">
            <MyBar view={shown} avatarRef={myBarRef} />
            <div ref={handWrapRef} className="relative mx-auto w-full max-w-[1100px] px-3 lg:px-0">
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-0 -bottom-3 h-28 bg-gradient-to-t from-gold/[0.16] via-gold/[0.05] to-transparent transition-opacity duration-500",
                  myTurn && me.canPlay ? "opacity-100" : "opacity-0",
                )}
              />
              <Hint show={selectTip.show} testId="hint-select" className="inset-x-0 bottom-[calc(100%+2.7rem)] mx-auto w-fit">
                Tap cards to pick 1–4, then play them face-down. You're allowed to lie!
              </Hint>
              <Hint show={dragTip.show && dragState === "idle"} testId="hint-drag" className="inset-x-0 bottom-[calc(100%+2.7rem)] mx-auto w-fit">
                Tip: drag your picked cards up onto the table to play.
              </Hint>
              <Hand
                cards={visibleHand}
                selected={selected}
                onToggle={toggleCard}
                requiredRank={next?.rank ?? null}
                interactive={view.status !== "reveal"}
                onLimit={onLimit}
                compact={short}
                arrivals={d.arrivals}
                waveKey={d.waveKey}
                drag={{
                  enabled: canDrag,
                  label: dragLabel,
                  onPlay: (cards) => {
                    dragTip.done();
                    play(cards);
                  },
                  onState: setDragState,
                }}
              />
            </div>
            <div className="relative">
              <Hint show={callTip.show} arrow="down" testId="hint-call" className="inset-x-0 -top-12 mx-auto w-fit">
                Think they're lying? Call bluff! Get it wrong and you pick up the pile.
              </Hint>
              <ActionBar
                room={room}
                view={view}
                selected={selected}
                onPlay={() => {
                  dragTip.done();
                  play(selected);
                }}
                onSelectMany={setSelected}
                limitHits={limitHits}
                compact={short}
                onCall={() => stageCall(d.callBluff)}
                onAccept={() => stageCall(d.acceptPlay)}
              />
            </div>
          </div>
        </Table>

        <AnimatePresence>
          {view.status === "reveal" && view.reveal && (
            <RevealOverlay key={`reveal-${view.reveal.until}`} view={view} serverNow={room.serverNow} pileFrom={pileFrom} />
          )}
        </AnimatePresence>
      </main>

      <FlyLayer flights={d.flights} sparks={d.sparks} onDone={d.endFlight} onSparkDone={d.endSpark} />
      <GameLog open={logOpen} onOpenChange={setLogOpen} log={view.log} />
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent title="Leave this game?" description="A bot will take over your cards and the game goes on without you.">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setLeaveOpen(false)}>
              Stay
            </Button>
            <Button variant="bluff" className="flex-1" data-testid="leave-game-confirm" loading={leaving} onClick={() => void confirmLeave()}>
              Leave game
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Screen-reader announcements: newest log line + "your turn". */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {latestLog ? describeLog(latestLog).text : ""}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {myTurn && view.turn ? `Your turn. Play ${RANK_PLURAL[view.turn.rank]}.` : ""}
      </div>
    </div>
  );
}

/** The in-game screen for `turn | challenge | reveal`. Renders nothing for other statuses. */
export function GameScreen({ room }: { room: RoomController }) {
  const view = room.view;
  if (!view || !PLAYABLE.has(view.status)) return null;
  return <GameScreenInner room={room} view={view} />;
}
