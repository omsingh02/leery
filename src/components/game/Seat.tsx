import { forwardRef, memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useAnimate } from "framer-motion";
import { Check, Crown, Flame, WifiOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useCountdown } from "@/hooks/useServerNow";
import { BOT_STYLES } from "@/lib/game";
import { spring } from "@/lib/motion";
import { useEffectsReduced } from "@/lib/prefs";
import type { PlayerView, Rank } from "@/lib/types";
import { clamp, cn } from "@/lib/utils";
import { PlayingCard } from "./PlayingCard";
import { RankChip } from "./RankChip";
import "./game.css";

export type SeatVariant = "mini" | "compact" | "default" | "large";
export type SeatRole = "accused" | "caller" | "picker" | null;

export interface SeatReaction {
  kind: "throw" | "accept";
  /** Change it to replay the reaction. */
  key: number;
}

export interface SeatProps {
  player: PlayerView;
  serverNow: () => number;
  variant?: SeatVariant;
  /** It's this player's turn to play. */
  active?: boolean;
  /** Server time the turn started (for the countdown ring's total). */
  turnSince?: number;
  /** Human turn timer deadline. null/undefined while `active` → a bot/autopilot is "thinking". */
  deadline?: number | null;
  role?: SeatRole;
  /** Accepted the pending play. */
  accepted?: boolean;
  /** Short caption under the name, e.g. "called bluff". */
  tag?: string | null;
  /** The claim this seat just made ("2 × Sevens") — shown as a chip while the challenge is open. */
  claim?: { count: number; rank: Rank } | null;
  /** While this seat is the accused: when the challenge window closes (the longer it waits, the more it sweats). */
  challengeDeadline?: number | null;
  /** A one-shot little animation (just threw cards, just accepted…). */
  reaction?: SeatReaction | null;
  /** Called for each step while a hand-count counts up (for tick sounds). */
  onCountStep?: (step: number, id: string) => void;
  /** Counts change without floating "+9"s (the opening deal). */
  quietCounts?: boolean;
  className?: string;
  style?: CSSProperties;
}

const DIM = {
  mini: { avatar: 32, fan: 0, width: 66, name: "text-[11px]" },
  compact: { avatar: 34, fan: 3.4, width: 74, name: "text-[11px]" },
  default: { avatar: 42, fan: 4.2, width: 92, name: "text-xs" },
  large: { avatar: 54, fan: 5.2, width: 124, name: "text-sm" },
} as const;

/** Circular countdown around the avatar — only mounted while a human's turn timer is running. */
function TimerRing({ since, deadline, serverNow, size }: { since: number; deadline: number; serverNow: () => number; size: number }) {
  const { remainingMs } = useCountdown(deadline, { serverNow }, 120);
  const left = remainingMs ?? 0;
  const frac = clamp(left / Math.max(1000, deadline - since), 0, 1);
  const r = size / 2 + 4;
  const c = 2 * Math.PI * r;
  const low = left < 8000 || frac < 0.2;
  const critical = left < 3500;
  const box = (r + 3) * 2;
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute left-1/2 top-1/2", critical && "animate-pulse")}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ transform: "translate(-50%, -50%) rotate(-90deg)" }}
    >
      <circle cx={box / 2} cy={box / 2} r={r} fill="none" stroke="hsl(0 0% 100% / 0.12)" strokeWidth={3} />
      <circle
        cx={box / 2}
        cy={box / 2}
        r={r}
        fill="none"
        stroke={low ? "hsl(var(--bluff))" : "hsl(var(--gold))"}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        style={{ filter: critical ? "drop-shadow(0 0 4px hsl(var(--bluff)))" : undefined }}
      />
    </svg>
  );
}

function MiniFan({ count, unit }: { count: number; unit: number }) {
  const n = Math.min(3, count);
  const w = unit * 5;
  const h = unit * 7;
  if (n === 0) {
    return <span aria-hidden className="inline-block rounded-[3px] border border-dashed border-white/25" style={{ width: w, height: h }} />;
  }
  const step = w * 0.45;
  return (
    <span aria-hidden className="relative inline-block" style={{ width: w + (n - 1) * step, height: h }}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={{ left: i * step, transform: `rotate(${(i - (n - 1) / 2) * 10}deg)`, transformOrigin: "50% 100%" }}
        >
          <PlayingCard faceDown unit={unit} />
        </span>
      ))}
    </span>
  );
}

/**
 * The hand-size badge. Going up by more than one (picking up the pile, the deal) it counts up one tick
 * at a time; going down it drops at once. Big changes float a "+9" / "−2" so the cost is readable.
 */
function CountBadge({ id, value, onStep, quiet }: { id: string; value: number; onStep?: (step: number, id: string) => void; quiet?: boolean }) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  const prev = useRef(value);
  const reduced = useEffectsReduced();
  const stepRef = useRef(onStep);
  const quietRef = useRef(quiet);
  useEffect(() => {
    stepRef.current = onStep;
    quietRef.current = quiet;
  });

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (value === from) return;
    const d = value - from;
    if (from > 0 && Math.abs(d) >= 2 && !quietRef.current) setDelta({ n: d, key: Date.now() });
    if (d <= 1 || reduced) {
      setShown(value);
      return;
    }
    const steps = Math.min(d, 10);
    const interval = clamp(520 / steps, 38, 80);
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setShown(i >= steps ? value : Math.round(from + (d * i) / steps));
      stepRef.current?.(i - 1, id);
      if (i >= steps) window.clearInterval(timer);
    }, interval);
    return () => {
      window.clearInterval(timer);
      setShown(value);
    };
  }, [value, id, reduced]);

  useEffect(() => {
    if (!delta) return;
    const t = window.setTimeout(() => setDelta(null), 1000);
    return () => window.clearTimeout(t);
  }, [delta]);

  return (
    <span className="relative inline-flex">
      <motion.span
        key={shown}
        data-testid={`seat-cards-${id}`}
        initial={{ scale: 1.4 }}
        animate={{ scale: 1 }}
        transition={spring.pop}
        className="min-w-[1.5rem] rounded-full bg-black/45 px-1.5 py-px text-[11px] font-bold tabular-nums text-foreground"
      >
        {shown}
      </motion.span>
      {delta && (
        <span
          key={delta.key}
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 animate-float-up whitespace-nowrap font-display text-xs font-extrabold",
            delta.n > 0 ? "text-bluff drop-shadow-[0_0_6px_hsl(var(--bluff)/0.8)]" : "text-muted",
          )}
        >
          {delta.n > 0 ? `+${delta.n}` : `−${-delta.n}`}
        </span>
      )}
    </span>
  );
}

const ROLE_TAG: Record<NonNullable<SeatRole>, string> = {
  accused: "bg-bluff/15 text-rose-200",
  caller: "bg-bluff/25 text-rose-100",
  picker: "bg-gold/20 text-gold",
};

/** An opponent at the table. */
export const Seat = memo(
  forwardRef<HTMLDivElement, SeatProps>(function Seat(
    {
      player,
      serverNow,
      variant = "default",
      active,
      turnSince,
      deadline,
      role = null,
      accepted,
      tag,
      claim,
      challengeDeadline,
      reaction,
      onCountStep,
      quietCounts,
      className,
      style,
    },
    ref,
  ) {
    const d = DIM[variant];
    const offline = !player.online && !player.bot;
    const thinking = active && deadline == null;
    const danger = player.cards > 0 && player.cards <= 2 && !player.left;
    const lastCard = player.cards === 1 && !player.left;
    const reduced = useEffectsReduced();
    const [scope, animate] = useAnimate();

    // The accused sweats as the window closes.
    const { remainingMs } = useCountdown(role === "accused" ? (challengeDeadline ?? null) : null, { serverNow }, 200);
    const nervous = !reduced && remainingMs != null && remainingMs < 2800;

    // One-shot reactions: pushing cards across the table, accepting a play.
    useEffect(() => {
      if (!reaction || reduced || !scope.current) return;
      void animate(
        scope.current,
        reaction.kind === "throw" ? { y: [0, 6, 0], scale: [1, 1.12, 1] } : { scale: [1, 1.16, 1] },
        { duration: reaction.kind === "throw" ? 0.34 : 0.28, ease: "easeOut" },
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps -- replay only when the reaction key changes
    }, [reaction?.key]);

    const ring = active
      ? "ring-2 ring-gold"
      : role === "accused"
        ? "ring-2 ring-bluff shadow-[0_0_16px_hsl(var(--bluff)/0.5)]"
        : role === "caller"
          ? "ring-2 ring-bluff/70"
          : role === "picker"
            ? "ring-2 ring-gold/80"
            : danger
              ? "ring-2 ring-bluff/80 animate-danger-pulse"
              : "ring-1 ring-white/10";

    const label = [
      player.name,
      player.bot ? "bot" : null,
      `${player.cards} card${player.cards === 1 ? "" : "s"}`,
      lastCard ? "last card!" : null,
      active ? "playing now" : null,
      player.auto ? "on autopilot" : null,
      player.left ? "left the game" : null,
      offline ? "offline" : null,
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <div
        ref={ref}
        data-testid={`seat-${player.id}`}
        role="group"
        aria-label={label}
        className={cn(
          "relative flex flex-col items-center gap-1 text-center transition-opacity",
          offline && (active ? "opacity-85" : "opacity-60"),
          player.left && "opacity-70",
          className,
        )}
        style={{ width: d.width, ...style }}
      >
        <div ref={scope} className={cn("relative rounded-full", nervous && "animate-tremble")} style={{ width: d.avatar, height: d.avatar }}>
          {active && <span aria-hidden className="absolute inset-0 rounded-full animate-ring-pulse" />}
          {active && <span aria-hidden className="leery-breathe absolute -inset-3 rounded-full bg-gold/25 blur-xl" />}
          <span className={cn("block rounded-full", thinking && !reduced && "animate-bob")}>
            <Avatar name={player.name} color={player.color} bot={player.bot} size={d.avatar} className={cn("transition-shadow", ring)} />
          </span>
          {active && deadline != null && turnSince != null && (
            <TimerRing since={turnSince} deadline={deadline} serverNow={serverNow} size={d.avatar} />
          )}
          {player.host && (
            <span aria-hidden className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-gold/60">
              <Crown className="h-2.5 w-2.5 text-gold" />
            </span>
          )}
          {accepted && (
            <span aria-hidden className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-trust text-ink ring-2 ring-background animate-pop-in">
              <span className="absolute inset-0 rounded-full ring-2 ring-trust animate-ping-once" />
              <Check className="relative h-2.5 w-2.5" strokeWidth={3.5} />
            </span>
          )}
          {offline && (
            <span aria-hidden className="absolute -left-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-white/20">
              <WifiOff className="h-2.5 w-2.5 text-amber-300" />
            </span>
          )}
          {nervous && (
            <>
              <i aria-hidden className="absolute -right-0.5 top-0 h-1.5 w-1 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-sky-300/90 animate-sweat" />
              <i aria-hidden className="absolute left-0 top-1 h-1.5 w-1 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-sky-300/80 animate-sweat [animation-delay:.55s]" />
            </>
          )}
        </div>

        <span className={cn("max-w-full truncate font-semibold leading-tight", d.name, active ? "text-gold" : "text-foreground")} title={player.name}>
          {player.name}
        </span>

        <div className="flex items-center gap-1.5" aria-hidden>
          {d.fan > 0 && <MiniFan count={player.cards} unit={d.fan} />}
          <CountBadge id={player.id} value={player.cards} onStep={onCountStep} quiet={quietCounts} />
        </div>

        <div className="flex min-h-[18px] flex-wrap items-center justify-center gap-1" aria-hidden>
          {thinking ? (
            <span className="inline-flex items-center gap-[3px] text-gold" title="Thinking…">
              <i className="leery-dot" />
              <i className="leery-dot" />
              <i className="leery-dot" />
            </span>
          ) : claim ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-bluff/15 py-px pl-1 pr-1.5 text-[10px] font-bold text-rose-100 animate-pop-in">
              <RankChip rank={claim.rank} size="sm" className="!h-[18px] !w-[13px] !text-[10px]" />×{claim.count}
            </span>
          ) : tag ? (
            <span className={cn("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", role ? ROLE_TAG[role] : "bg-white/10 text-muted")}>
              {tag}
            </span>
          ) : lastCard ? (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-bluff/20 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-rose-100">
              <Flame className="h-2.5 w-2.5" /> Last card
            </span>
          ) : null}
          {player.bot && (
            <span
              className="rounded-full bg-primary/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-violet-200"
              title={player.style ? `${BOT_STYLES[player.style].label}: ${BOT_STYLES[player.style].blurb}` : "Bot"}
            >
              Bot{variant === "large" && player.style ? ` · ${BOT_STYLES[player.style].label}` : ""}
            </span>
          )}
          {player.auto && !player.bot && (
            <span className="rounded-full bg-gold/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-gold">Auto</span>
          )}
          {player.left && (
            <span className="rounded-full bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-muted">Left</span>
          )}
        </div>
      </div>
    );
  }),
);
