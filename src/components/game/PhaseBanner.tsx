import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useCountdown } from "@/hooks/useServerNow";
import { nextRank, playerById, RANK_PLURAL } from "@/lib/game";
import type { RoomView } from "@/lib/types";
import { RankChip } from "./RankChip";
import { cn } from "@/lib/utils";
import "./game.css";

export { RankChip };

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Clock({ deadline, serverNow }: { deadline: number; serverNow: () => number }) {
  const { remainingMs } = useCountdown(deadline, { serverNow });
  const low = (remainingMs ?? 0) < 8000;
  return (
    <span className={cn("font-semibold tabular-nums", low ? "text-bluff" : "text-foreground")} data-testid="turn-clock">
      {fmt(remainingMs ?? 0)}
    </span>
  );
}

const Overline = ({ children, tone = "muted" }: { children: ReactNode; tone?: "gold" | "bluff" | "muted" }) => (
  <span
    className={cn(
      "fit-over text-[11px] font-bold uppercase tracking-[0.22em]",
      tone === "gold" && "text-gold",
      tone === "bluff" && "text-bluff",
      tone === "muted" && "text-muted",
    )}
  >
    {children}
  </span>
);

const Title = ({ children }: { children: ReactNode }) => (
  <h2 className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-display text-lg font-bold leading-tight sm:text-xl lg:text-2xl [@media(max-height:700px)]:text-base [@media(max-height:700px)]:lg:text-xl">
    {children}
  </h2>
);

const Sub = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("fit-sub text-xs text-muted sm:text-sm [@media(max-height:700px)]:hidden", className)}>{children}</p>
);

/**
 * The big status line on the felt: whose turn it is and which rank must be claimed, or — during the
 * challenge window — what was just played and what everyone can do about it.
 */
export const PhaseBanner = memo(function PhaseBanner({ view, serverNow }: { view: RoomView; serverNow: () => number }) {
  const { status, turn, challenge, me, players } = view;

  let key = status as string;
  let content: ReactNode = null;
  /** During a reveal the overlay tells the story; the banner keeps its space (so the pile doesn't jump) but says nothing. */
  let quiet = false;

  if (status === "turn" && turn) {
    const who = playerById(players, turn.player);
    const mine = turn.player === me.id;
    key = `turn:${turn.player}:${turn.rank}:${turn.since}`;
    content = mine && me.auto ? (
      <>
        <Overline tone="gold">Autopilot</Overline>
        <Title>
          <span className="text-muted">Playing</span>
          <RankChip rank={turn.rank} size="lg" />
          <span className="text-gold">{RANK_PLURAL[turn.rank]}</span>
          <span className="text-muted">for you…</span>
        </Title>
        <Sub>Tap Resume below to take over your cards.</Sub>
      </>
    ) : mine ? (
      <>
        <Overline tone="gold">Your turn</Overline>
        <Title>
          <span>Play</span>
          <RankChip rank={turn.rank} size="lg" />
          <span className="text-gold">{RANK_PLURAL[turn.rank]}</span>
        </Title>
        <Sub>
          Face-down — and you're allowed to lie. Next up: <b className="text-foreground">{RANK_PLURAL[nextRank(turn.rank)]}</b>
        </Sub>
      </>
    ) : (
      <>
        <Overline>{who ? `${who.name}'s turn` : "Waiting"}</Overline>
        <Title>
          <span className="max-w-[12ch] truncate sm:max-w-[18ch]">{who?.name ?? "Someone"}</span>
          <span className="text-muted">is playing</span>
          <RankChip rank={turn.rank} size="lg" />
          <span className="text-gold">{RANK_PLURAL[turn.rank]}…</span>
        </Title>
        <Sub className="flex items-center gap-2">
          {turn.deadline != null ? (
            <>
              <Clock deadline={turn.deadline} serverNow={serverNow} /> left
            </>
          ) : (
            <span className="inline-flex items-center gap-[3px] text-gold" aria-label="Thinking">
              <i className="leery-dot" />
              <i className="leery-dot" />
              <i className="leery-dot" />
            </span>
          )}
          <span aria-hidden>·</span>
          <span>
            then <b className="text-foreground">{RANK_PLURAL[nextRank(turn.rank)]}</b>
          </span>
        </Sub>
      </>
    );
  } else if (status === "challenge" && challenge) {
    const by = playerById(players, challenge.by);
    const accused = challenge.by === me.id;
    key = `challenge:${challenge.by}:${challenge.since}`;
    const prompt = accused
      ? "Keep your poker face on."
      : me.passed
        ? "You accepted. Waiting on the others…"
        : me.canCall || me.canPass
          ? "Call it — or let it slide?"
          : "Waiting…";
    content = (
      <>
        <Overline tone="bluff">Challenge</Overline>
        <Title>
          <span className="max-w-[12ch] truncate sm:max-w-[18ch]">{accused ? "You" : (by?.name ?? "Someone")}</span>
          <span className="text-muted">played</span>
          <span>
            {challenge.count} card{challenge.count === 1 ? "" : "s"}
          </span>
        </Title>
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted sm:text-base">
          <span>claims</span>
          <span className="font-bold text-foreground">{challenge.count} ×</span>
          <RankChip rank={challenge.rank} size="sm" />
          <b className="text-gold">{RANK_PLURAL[challenge.rank]}</b>
        </p>
        <p className="fit-prompt text-sm font-semibold text-foreground">{prompt}</p>
      </>
    );
  } else if (status === "reveal") {
    quiet = true;
    content = (
      <>
        <Overline tone="bluff">Bluff called</Overline>
        <Title>Cards on the table</Title>
      </>
    );
  }

  return (
    <motion.div
      key={key}
      data-testid="phase-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-hidden={quiet || undefined}
      className={cn("flex max-w-[36rem] flex-col items-center gap-1.5 px-2 text-center", quiet && "invisible")}
    >
      {content}
    </motion.div>
  );
});
