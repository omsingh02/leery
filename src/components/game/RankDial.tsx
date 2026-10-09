import { memo } from "react";
import { nextRank, RANK_SINGULAR } from "@/lib/game";
import { RANKS, type Rank } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RankDialProps {
  /** The rank being claimed right now. */
  rank: Rank;
  /** How many of each rank I hold — a dot under the ranks where I could play honestly. */
  mine?: Readonly<Partial<Record<Rank, number>>>;
  /** The rank I'll have to claim on my next turn. */
  mark?: Rank | null;
  className?: string;
}

/**
 * The rule of the game, always in sight: the claimed rank steps A → 2 → … → K → A every turn, so
 * the gold marker slides one place per play. The dots under the ranks show where my own cards are
 * (honest plays I can look forward to); the little arrow shows what I'll be claiming next.
 */
export const RankDial = memo(function RankDial({ rank, mine, mark, className }: RankDialProps) {
  const next = nextRank(rank);
  const index = RANKS.indexOf(rank);
  return (
    <div
      data-testid="rank-dial"
      role="img"
      aria-label={`Claimed rank: ${RANK_SINGULAR[rank]}. Next: ${RANK_SINGULAR[next]}.`}
      className={cn("relative flex w-full max-w-[21rem] items-end gap-px lg:max-w-[27rem]", className)}
    >
      {/* The marker slides one place per turn — a plain CSS transform, so it can never drift or fly in from elsewhere. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[0.55rem] left-0 h-6 rounded-md bg-gradient-to-b from-gold to-amber-500 shadow-glow-gold lg:h-7"
        style={{
          width: "calc((100% - 12px) / 13)",
          transform: `translateX(calc(${index} * (100% + 1px)))`,
          transition: "transform 380ms cubic-bezier(0.34, 1.45, 0.5, 1)",
        }}
      />
      {RANKS.map((r) => {
        const here = r === rank;
        const have = mine?.[r] ?? 0;
        return (
          <span key={r} className="relative flex min-w-0 flex-1 flex-col items-center">
            <span aria-hidden className={cn("h-1.5 text-[8px] leading-none text-primary", mark === r && !here ? "opacity-100" : "opacity-0")}>
              ▼
            </span>
            <span
              className={cn(
                "relative grid h-6 w-full place-items-center font-display text-[10px] font-bold leading-none transition-colors duration-200 sm:text-[11px] lg:h-7 lg:text-xs",
                here ? "text-ink" : r === next ? "text-foreground" : "text-muted/55",
              )}
            >
              <span className="relative">{r}</span>
            </span>
            <span
              aria-hidden
              className={cn("mt-0.5 h-1 rounded-full transition-all duration-200", have ? (here ? "w-2.5 bg-gold" : "w-1 bg-primary/80") : "w-1 bg-transparent")}
              style={have > 1 && !here ? { width: Math.min(10, 3 + have * 2) } : undefined}
            />
          </span>
        );
      })}
    </div>
  );
});
