import { memo, useEffect, useState, type ReactNode } from "react";
import { Bot, Hourglass, Megaphone, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoomController } from "@/hooks/useRoom";
import { useCountdown } from "@/hooks/useServerNow";
import { playerById, rankOf, RANK_PLURAL, RANK_SINGULAR } from "@/lib/game";
import { feel } from "@/lib/feel";
import type { CardCode, RoomView } from "@/lib/types";
import { clamp, cn } from "@/lib/utils";
import "./game.css";

interface ActionBarProps {
  room: RoomController;
  view: RoomView;
  selected: readonly CardCode[];
  onPlay: () => void;
  onSelectMany: (codes: CardCode[]) => void;
  /** Bumps each time the player tries to pick a 5th card (flashes the "max 4" hint). */
  limitHits: number;
  /** Short viewport: slimmer buttons, no hint line. */
  compact?: boolean;
  /** Call bluff / accept: staged by the director so the feedback is instant. */
  onCall: () => Promise<boolean>;
  onAccept: () => Promise<boolean>;
}

/** Draining bar + seconds for the challenge window. Warms from mint to amber to red as it runs out. */
function WindowTimer({ since, deadline, serverNow }: { since: number; deadline: number; serverNow: () => number }) {
  const { remainingMs, seconds } = useCountdown(deadline, { serverNow }, 80);
  const left = remainingMs ?? 0;
  const frac = clamp(left / Math.max(1000, deadline - since), 0, 1);
  const low = left < 2000;
  const mid = !low && frac < 0.4;

  return (
    <div className="flex items-center gap-3" aria-hidden>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-100 ease-linear",
            low
              ? "animate-pulse bg-bluff shadow-[0_0_12px_hsl(var(--bluff))]"
              : mid
                ? "bg-gradient-to-r from-gold to-amber-500 shadow-[0_0_8px_hsl(var(--gold)/0.6)]"
                : "bg-gradient-to-r from-trust to-primary",
          )}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
      <span data-testid="window-seconds" className={cn("w-9 text-right font-display text-sm font-bold tabular-nums", low ? "text-bluff" : mid ? "text-gold" : "text-foreground")}>
        {seconds ?? 0}s
      </span>
    </div>
  );
}

const Info = ({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) => (
  <div
    className={cn(
      "flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm text-muted [&>span]:text-balance",
      className,
    )}
  >
    {icon}
    <span>{children}</span>
  </div>
);

/** Bottom controls. Which ones show is entirely driven by the server's `me.canPlay / canCall / canPass`. */
export const ActionBar = memo(function ActionBar({ room, view, selected, onPlay, onSelectMany, limitHits, compact = false, onCall, onAccept }: ActionBarProps) {
  const { status, turn, challenge, me, players } = view;
  const busy = room.busy;

  const [flash, setFlash] = useState<"max" | "pick" | null>(null);
  const [nudges, setNudges] = useState(0);
  useEffect(() => {
    if (limitHits === 0) return;
    setFlash("max");
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [limitHits]);
  useEffect(() => {
    if (nudges === 0) return;
    setFlash("pick");
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [nudges]);

  const autoBanner = me.auto ? (
    <div className="mb-2 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/10 px-3.5 py-2.5">
      <Bot className="h-5 w-5 shrink-0 text-gold" aria-hidden />
      <p className="flex-1 text-sm leading-snug text-foreground">
        <b>You're on autopilot</b> — a bot is playing your cards.
      </p>
      <Button size="sm" variant="gold" data-testid="resume-auto" loading={busy} onClick={() => void room.resume()}>
        Resume
      </Button>
    </div>
  ) : null;

  let body: ReactNode = null;

  if (status === "turn" && turn) {
    if (me.canPlay) {
      const honest = me.hand.filter((c) => rankOf(c) === turn.rank).slice(0, 4);
      const alreadyHonest = honest.length > 0 && honest.length === selected.length && honest.every((c) => selected.includes(c));
      const n = selected.length;
      body = (
        <div className="flex flex-col gap-2">
          {/* Fixed-height row: chips come and go without moving the buttons below. */}
          <div className={cn("flex items-center justify-center gap-2", compact ? "h-8" : "h-9")}>
            {honest.length > 0 && !alreadyHonest && (
              <button
                type="button"
                data-testid="select-honest"
                onClick={() => {
                  feel.emit({ type: "card.wave", n: honest.length });
                  onSelectMany(honest);
                }}
                className="rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/20 active:scale-95"
              >
                Select my {honest.length} {honest.length === 1 ? RANK_SINGULAR[turn.rank] : RANK_PLURAL[turn.rank]}
              </button>
            )}
            {n > 0 && (
              <button
                type="button"
                data-testid="clear-selection"
                onClick={() => {
                  feel.emit({ type: "card.deselect", n: 0 });
                  onSelectMany([]);
                }}
                className="rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-muted transition-colors hover:bg-white/10 hover:text-foreground active:scale-95"
              >
                Clear
              </button>
            )}
          </div>
          <Button
            size={compact ? "lg" : "xl"}
            data-testid="play-button"
            className={cn("w-full", n === 0 && "opacity-50 saturate-50")}
            aria-disabled={n === 0 || undefined}
            loading={busy}
            onClick={() => {
              if (n === 0) {
                // A disabled button that explains itself: nudge the hint and say "not yet".
                feel.emit({ type: "card.limit" });
                setNudges((k) => k + 1);
                return;
              }
              onPlay();
            }}
          >
            {n === 0 ? "Pick 1–4 cards to play" : `Play ${n} card${n === 1 ? "" : "s"} as ${RANK_PLURAL[turn.rank]}`}
          </Button>
          <p key={flash ? `${flash}${limitHits}${nudges}` : "idle"} className={cn("text-center text-xs", flash ? "animate-shake font-semibold text-gold" : "text-muted", compact && !flash && "hidden")}>
            {flash === "max" ? "Max 4 cards per turn" : flash === "pick" ? "Tap 1–4 cards in your hand first" : `${n}/4 selected · face-down — lie if you like`}
          </p>
        </div>
      );
    } else if (!me.auto) {
      const who = playerById(players, turn.player);
      body = (
        <Info icon={<Hourglass className="h-4 w-4 shrink-0" aria-hidden />}>
          Waiting for <b className="text-foreground">{who?.name ?? "someone"}</b>
          {selected.length > 0 ? ` · ${selected.length} card${selected.length === 1 ? "" : "s"} ready` : " · pick your cards ahead of time"}
        </Info>
      );
    }
  } else if (status === "challenge" && challenge) {
    const canAct = (me.canCall || me.canPass) && !me.passed;
    body = (
      <div className="flex flex-col gap-3">
        <WindowTimer since={challenge.since} deadline={challenge.deadline} serverNow={room.serverNow} />
        {canAct ? (
          // A 3:2 grid, not flex: flex-grow would split only the space left *after* each button's padding, which
          // flattens the ratio (and let Accept spill off the screen on a 360px phone). Tighter padding on narrow screens.
          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <div className="relative">
              {/* the pulsing glow lives on its own layer (opacity/scale only), so it costs no repaint */}
              <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full bg-bluff/55 blur-lg animate-glow-breathe" />
              <Button
                variant="bluff"
                size={compact ? "lg" : "xl"}
                data-testid="call-bluff"
                className="relative w-full overflow-hidden px-4 min-[380px]:px-7"
                disabled={!me.canCall}
                loading={busy}
                onClick={() => void onCall()}
              >
                <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                  <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shine" />
                </span>
                <Megaphone className="relative h-5 w-5" aria-hidden />
                <span className="relative">Call bluff!</span>
              </Button>
            </div>
            <Button
              variant="trust"
              size={compact ? "lg" : "xl"}
              data-testid="accept-play"
              className="w-full px-4 min-[380px]:px-7"
              disabled={!me.canPass || busy}
              onClick={() => void onAccept()}
            >
              <Check className="h-5 w-5" aria-hidden />
              Accept
            </Button>
          </div>
        ) : me.passed ? (
          <Info icon={<Check className="h-4 w-4 shrink-0 text-trust" aria-hidden />}>You accepted — waiting for the others</Info>
        ) : (
          <Info icon={<Hourglass className="h-4 w-4 shrink-0" aria-hidden />}>
            {challenge.by === me.id ? "Everyone's deciding…" : "Hang tight…"}
          </Info>
        )}
      </div>
    );
  } else if (status === "reveal") {
    body = <Info icon={<Megaphone className="h-4 w-4 shrink-0 text-bluff" aria-hidden />}>Cards are being revealed…</Info>;
  }

  return (
    <div className={cn("safe-pb mx-auto flex w-full max-w-xl shrink-0 flex-col justify-end px-3 pt-2", compact ? "min-h-[5.9rem]" : "min-h-[8.4rem]")}>
      {autoBanner}
      {body}
    </div>
  );
});
