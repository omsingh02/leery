import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, LogOut, RotateCcw, Trophy } from "lucide-react";
import { Badge } from "@/components/shell/Badge";
import { WaitingDots } from "@/components/shell/WaitingDots";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { RoomController } from "@/hooks/useRoom";
import { feel } from "@/lib/feel";
import { COLOR } from "@/lib/feel/plan";
import { useFx, useShakeTarget } from "@/lib/fx";
import { playerById } from "@/lib/game";
import { spring } from "@/lib/motion";
import { useEffectsReduced } from "@/lib/prefs";
import type { RoomView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "./helpers";

const cardsLeft = (n: number) => (n === 0 ? "Cleared" : `${n} card${n === 1 ? "" : "s"} left`);

type GraphemeSegmenter = new (locale?: string, options?: { granularity: "grapheme" }) => { segment(text: string): Iterable<{ segment: string }> };

/** User-perceived characters: a flag, a family emoji or an accented letter is one unit, not several code points. */
const graphemes = (text: string): string[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
};

/** A long name has to fit the line: names run up to 16 characters in a very wide display face. */
const headlineSize = (text: string): string => {
  const longest = Math.max(...text.split(" ").map((w) => graphemes(w).length));
  return longest > 12
    ? "text-[1.5rem] max-[340px]:text-[1.2rem] sm:text-3xl"
    : longest > 9
      ? "text-[1.85rem] max-[340px]:text-[1.5rem] sm:text-4xl"
      : "text-[2.4rem] max-[340px]:text-[2rem] sm:text-5xl";
};

/** The headline, one word at a time, each letter dropping in — readable as plain text by screen readers. */
function Headline({ text, reduced, className }: { text: string; reduced: boolean; className?: string }) {
  const words = text.split(" ");
  let n = 0;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      {words.map((word, wi) => (
        <Fragment key={wi}>
          {wi > 0 ? " " : null}
          {/* Plain inline + no-wrap: a word stays in one piece, and — unlike an inline-block — never grows a second
              line box that the headline's gradient (background-clip: text) would fail to cover. */}
          <span aria-hidden className="whitespace-nowrap">
            {graphemes(word).map((ch) => {
              const i = n++;
              return (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, rotate: (i % 2 ? 1 : -1) * 9, scale: 0.7 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, rotate: 0, scale: 1 }}
                  transition={{ ...spring.pop, delay: 0.5 + i * 0.035 }}
                >
                  {ch}
                </motion.span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function GameOver({ room, view }: { room: RoomController; view: RoomView }) {
  const navigate = useNavigate();
  const reduced = useEffectsReduced();
  const fx = useFx();
  const [rematching, setRematching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const crownRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useShakeTarget(mainRef);

  const { players, me, winner: winnerId } = view;
  const winner = playerById(players, winnerId);
  const iWon = winnerId === me.id;
  const host = players.find((p) => p.host);

  // Winner first, then fewest cards left (ties by seat).
  const standings = useMemo(
    () =>
      [...players].sort((a, b) => {
        if (a.id === winnerId) return -1;
        if (b.id === winnerId) return 1;
        return a.cards - b.cards || a.seat - b.seat;
      }),
    [players, winnerId],
  );
  /** Competition ranking: equal card counts share a place; the winner is always 1st. */
  const placeOf = (id: string, cards: number) =>
    id === winnerId ? 1 : 2 + players.filter((o) => o.id !== winnerId && o.cards < cards).length;
  const myPlace = placeOf(me.id, players.find((p) => p.id === me.id)?.cards ?? 0);

  useDocumentTitle(iWon ? "You won! · Leery" : `${winner?.name ?? "Someone"} won · Leery`);

  // The finale: sound, vibration, and (for a win) confetti cannons from the corners and a glint where the crown lands.
  const staged = useRef(false);
  useEffect(() => {
    // The one-shot sound and bursts happen once per mount; the vignette and the timer are (re)applied on every run
    // so the dev-only effect double-run (StrictMode) tears down and sets up cleanly.
    const first = !staged.current;
    staged.current = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let glint: number | undefined;
    if (iWon) {
      if (first) {
        feel.emit({ type: "game.win", at: { x: w / 2, y: h * 0.26 } });
        fx.burst("confetti", { x: -8, y: h + 8 }, { count: 46, power: 1, spread: 46, angle: -58, delay: 0.25 });
        fx.burst("confetti", { x: w + 8, y: h + 8 }, { count: 46, power: 1, spread: 46, angle: -122, delay: 0.25 });
      }
      // A glint where the crown lands — measured when it has landed (it starts well above the screen).
      glint = window.setTimeout(() => {
        const crown = crownRef.current?.getBoundingClientRect();
        if (crown) fx.burst("glints", { x: crown.left + crown.width / 2, y: crown.top + crown.height / 2 }, { count: 14, power: 0.5, spread: 360, color: [COLOR.gold, COLOR.ivory] });
      }, 1000);
    } else {
      if (first) feel.emit({ type: "game.lose" });
      fx.vignette(0.3, COLOR.violet);
    }
    return () => {
      window.clearTimeout(glint);
      fx.vignette(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staged once per mount
  }, []);

  async function rematch() {
    if (rematching) return;
    setRematching(true);
    const ok = await room.rematch();
    if (!ok) setRematching(false); // on success the lobby replaces this screen
  }

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    const ok = await room.leave();
    if (ok) navigate("/");
    else setLeaving(false);
  }

  const headline = iWon ? "You win!" : `${winner?.name ?? "Someone"} wins!`;
  const subline = iWon
    ? "You cleared your hand. Smooth liar."
    : `You finished #${myPlace} with ${cardsLeft(players.find((p) => p.id === me.id)?.cards ?? 0).toLowerCase()}.`;

  return (
    <main
      ref={mainRef}
      data-testid="game-over"
      className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-4 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),2.5rem)]"
    >
      {/* spotlight from above: gold for a win, cool violet-grey for a loss */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-[1]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9 }}
        style={{
          background: iWon
            ? "radial-gradient(70% 50% at 50% 12%, hsl(var(--gold) / 0.2), transparent 70%)"
            : "radial-gradient(70% 50% at 50% 12%, hsl(var(--primary) / 0.16), transparent 70%)",
        }}
      />

      <div className="relative z-20 w-full text-center">
        <div className="relative mx-auto grid h-32 w-32 place-items-center">
          <div aria-hidden className={cn("absolute inset-2 rounded-full blur-2xl animate-pulse", iWon ? "bg-gold/35" : "bg-primary/25")} />
          <div aria-hidden className={cn("absolute inset-0 rounded-full border animate-ring-pulse", iWon ? "border-gold/30" : "border-primary/30")} />
          <motion.div
            initial={reduced ? { opacity: 0 } : { y: -220, rotate: -18, scale: 0.7, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, rotate: 0, scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 210, damping: 13, mass: 1.1, delay: 0.1 }}
            className="relative"
          >
            {winner ? (
              <div className={cn("rounded-full ring-4", iWon ? "ring-gold/70" : "ring-white/25")}>
                <Avatar name={winner.name} color={winner.color} bot={winner.bot} size={96}>
                  <motion.div
                    ref={crownRef}
                    initial={reduced ? { opacity: 0 } : { y: -42, opacity: 0, rotate: 14, scale: 1.3 }}
                    animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1, rotate: -6, scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.62 }}
                    className="absolute -top-7 left-1/2 -ml-[18px]"
                  >
                    <Crown className="h-9 w-9 fill-gold text-gold drop-shadow-[0_0_12px_hsl(var(--gold))]" aria-hidden />
                  </motion.div>
                </Avatar>
              </div>
            ) : (
              <Trophy className="h-20 w-20 text-gold" aria-hidden />
            )}
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 0.4 }}
          className={cn("mt-7 text-xs font-semibold uppercase tracking-[0.28em]", iWon ? "text-gold" : "text-muted")}
        >
          {iWon ? "Victory" : "Game over"}
        </motion.p>
        <h1 data-testid="winner-name" className={cn("mt-1.5 break-words font-display font-black leading-[1.05] tracking-tight", headlineSize(headline))}>
          <Headline
            text={headline}
            reduced={reduced}
            className={cn(
              "bg-gradient-to-b bg-clip-text text-transparent",
              iWon
                ? "from-amber-100 via-gold to-amber-500 drop-shadow-[0_0_26px_hsl(var(--gold)/0.45)]"
                : "from-foreground via-violet-200 to-violet-400 drop-shadow-[0_0_22px_hsl(var(--primary)/0.35)]",
            )}
          />
        </h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.95, duration: 0.4 }} className="mt-2 text-sm text-muted">
          {subline}
        </motion.p>
      </div>

      <motion.section
        aria-labelledby="standings-heading"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.85 }}
        className="glass relative z-20 mt-7 w-full rounded-3xl p-4"
      >
        <h2 id="standings-heading" className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
          Final standings
        </h2>
        <ol data-testid="standings" className="space-y-1.5">
          {standings.map((p, i) => {
            const isWinner = p.id === winnerId;
            return (
              <motion.li
                key={p.id}
                data-testid={`standing-${p.id}`}
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring.snappy, delay: 0.95 + i * 0.07 }}
                className={cn(
                  "relative flex h-[52px] items-center gap-3 overflow-hidden rounded-2xl border px-3",
                  isWinner ? "border-gold/40 bg-gold/[0.08]" : p.id === me.id ? "border-primary/35 bg-white/[0.04]" : "border-white/[0.06] bg-white/[0.03]",
                )}
              >
                {isWinner && !reduced && (
                  <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-gold/25 to-transparent animate-shine" />
                  </span>
                )}
                <span
                  className={cn(
                    "relative grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
                    isWinner ? "bg-gold text-ink" : "bg-white/10 text-muted",
                  )}
                >
                  <span className="sr-only">Place {placeOf(p.id, p.cards)}</span>
                  {isWinner ? <Trophy className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden>{placeOf(p.id, p.cards)}</span>}
                </span>
                <Avatar name={p.name} color={p.color} bot={p.bot} size={34} />
                <div className="relative flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate font-semibold">{p.name}</span>
                  {p.id === me.id && <Badge tone="primary">You</Badge>}
                  {p.left && <Badge>Left</Badge>}
                </div>
                <span className={cn("relative shrink-0 text-sm tabular-nums", isWinner ? "font-semibold text-gold" : "text-muted")}>
                  {p.cards === 0 ? (
                    "Cleared"
                  ) : (
                    <>
                      {p.cards}
                      <span className="max-[339px]:hidden"> card{p.cards === 1 ? "" : "s"}</span> left
                    </>
                  )}
                </span>
              </motion.li>
            );
          })}
        </ol>
      </motion.section>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 1.25 }}
        className="relative z-20 mt-6 flex w-full flex-col gap-2.5"
      >
        {me.host ? (
          <Button variant="gold" size="xl" className="relative w-full overflow-hidden" data-testid="rematch" loading={rematching} onClick={() => void rematch()}>
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shine" />
            </span>
            <RotateCcw className="relative h-5 w-5" aria-hidden />
            <span className="relative">Play again</span>
          </Button>
        ) : (
          <p
            role="status"
            data-testid="waiting-rematch"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-center text-sm"
          >
            Waiting for <strong className="font-semibold text-gold">{host?.name ?? "the host"}</strong> to start another round{" "}
            <WaitingDots className="ml-0.5 inline-flex items-center gap-1 align-middle text-muted" />
          </p>
        )}
        <Button variant="ghost" className="w-full" data-testid="leave-game" loading={leaving} onClick={() => void leave()}>
          <LogOut className="h-4 w-4" aria-hidden />
          Leave
        </Button>
      </motion.div>
    </main>
  );
}
