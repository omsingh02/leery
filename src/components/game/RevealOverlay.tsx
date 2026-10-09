import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Megaphone, Trophy, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { feel } from "@/lib/feel";
import { playerById, rankOf, RANK_PLURAL } from "@/lib/game";
import { ease, spring } from "@/lib/motion";
import { useEffectsReduced } from "@/lib/prefs";
import type { CardCode, PlayerView, RevealView, RoomView } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Point } from "./FlyLayer";
import { PlayingCard } from "./PlayingCard";
import { RankChip } from "./RankChip";
import { revealSkip, revealTimeline } from "./revealTimeline";
import { useMediaQuery } from "./useMediaQuery";
import "./game.css";

const centerOf = (el: Element | null): Point | undefined => {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

interface FlipProps {
  code: CardCode;
  claimed: RevealView["rank"];
  unit: number;
  /** Seconds after the cards emerge until this card turns over. */
  flipAt: number;
  /** Seconds after the cards emerge until the card starts to shiver (only the last one waits). */
  teaseAt: number | null;
  /** Where the pile is, so the card can rise out of it. */
  from: Point | null;
  reduced: boolean;
  /** Reports the card (as it turns over). */
  onFlip: (el: HTMLElement | null) => void;
}

type Phase = "rest" | "tease" | "flip";

/** A card that rises out of the pile face-down, then turns over to show what it really was (green = matches the claim, red = lie). */
function FlipCard({ code, claimed, unit, flipAt, teaseAt, from, reduced, onFlip }: FlipProps) {
  const ok = rankOf(code) === claimed;
  const w = unit * 5;
  const h = unit * 7;
  const slot = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState<{ x: number; y: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("rest");

  // Measure where this card lands, so it can travel there from the pile.
  useLayoutEffect(() => {
    const c = centerOf(slot.current);
    setOff(c && from ? { x: from.x - c.x, y: from.y - c.y } : { x: 0, y: 30 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pile position at mount is what matters
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    if (teaseAt !== null && !reduced) timers.push(window.setTimeout(() => setPhase("tease"), Math.max(0, teaseAt) * 1000));
    timers.push(window.setTimeout(() => setPhase("flip"), Math.max(0, flipAt) * 1000));
    timers.push(window.setTimeout(() => onFlip(slot.current), Math.max(0, flipAt) * 1000 + (reduced ? 0 : 200)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduled once per card
  }, []);

  const face = (
    <PlayingCard code={code} unit={unit} className={ok ? "ring-2 ring-trust shadow-glow-trust" : "ring-2 ring-bluff shadow-glow-bluff"} />
  );
  const turned = phase === "flip";
  return (
    <div className="relative pb-9" data-reveal-card="" data-ok={ok ? "1" : "0"}>
      <div ref={slot} style={{ perspective: 900, width: w, height: h }}>
        {off === null ? null : reduced ? (
          <div className="relative" style={{ width: w, height: h }}>
            <div className="absolute inset-0 transition-opacity duration-200" style={{ opacity: turned ? 0 : 1 }}>
              <PlayingCard faceDown unit={unit} />
            </div>
            <div className="absolute inset-0 transition-opacity duration-200" style={{ opacity: turned ? 1 : 0 }}>
              {face}
            </div>
          </div>
        ) : (
          <motion.div
            className="relative"
            style={{ width: w, height: h, transformStyle: "preserve-3d" }}
            initial={{ x: off.x, y: off.y, scale: 0.55, rotate: (code.charCodeAt(0) % 7) - 3 }}
            animate={{ x: 0, y: 0, scale: 1, rotate: 0 }}
            transition={{ duration: 0.5, ease: ease.out }}
          >
            {/* tease → the last card lifts and shivers; flip → everything settles as it turns */}
            <motion.div
              className="relative"
              style={{ width: w, height: h, transformStyle: "preserve-3d" }}
              animate={
                phase === "tease"
                  ? { y: [-6, -11, -6], rotate: [-1.6, 1.6, -1.6], scale: 1.07 }
                  : phase === "flip"
                    ? { y: [-12, 0], rotate: 0, scale: [1.14, 1] }
                    : { y: 0, rotate: 0, scale: 1 }
              }
              transition={phase === "tease" ? { duration: 0.34, repeat: Infinity, ease: "easeInOut" } : { duration: 0.46, ease: ease.out }}
            >
              <motion.div
                className="relative"
                style={{ width: w, height: h, transformStyle: "preserve-3d" }}
                animate={{ rotateY: turned ? 180 : 0 }}
                transition={{ duration: 0.46, ease: [0.3, 1.1, 0.4, 1] }}
              >
                <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
                  <PlayingCard faceDown unit={unit} />
                </div>
                <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                  {face}
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </div>
      <motion.span
        aria-hidden
        initial={{ opacity: 0, scale: 0.4 }}
        animate={turned ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.4 }}
        transition={{ delay: 0.34, ...spring.pop }}
        className={cn(
          "absolute bottom-1 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full text-background",
          ok ? "bg-trust" : "bg-bluff",
        )}
      >
        {ok ? <Check className="h-4 w-4" strokeWidth={3.5} /> : <X className="h-4 w-4" strokeWidth={3.5} />}
      </motion.span>
    </div>
  );
}

function Body({ reveal, players, serverNow, pileFrom }: { reveal: RevealView; players: PlayerView[]; serverNow: () => number; pileFrom: Point | null }) {
  const reduced = useEffectsReduced();
  const desktop = useMediaQuery("(min-width: 1024px)");
  // Fewer cards → bigger cards (4 × 5em must still fit a phone: 13em·5·4 + gaps ≈ 330px).
  const count = reveal.cards.length;
  const unit = desktop ? (count <= 3 ? 20 : 18) : count <= 2 ? 16 : count === 3 ? 15 : 13;
  const tl = useMemo(() => revealTimeline(count), [count]);

  // Joined mid-reveal? Compress the choreography so the verdict still lands before the server moves on.
  const [skip] = useState(() => revealSkip(tl, reveal.until - serverNow()));
  const at = (ms: number) => Math.max(0, ms - skip);

  const [stage, setStage] = useState(0); // 0 header · 1 claim · 2 cards · 3 verdict · 4 pickup · 5 aftermath
  const stampRef = useRef<HTMLDivElement>(null);
  const [scrimOut, setScrimOut] = useState(false);

  useEffect(() => {
    const last = tl.flips[tl.flips.length - 1];
    const timers = [
      setTimeout(() => setStage((s) => Math.max(s, 1)), at(tl.claim)),
      setTimeout(() => setStage((s) => Math.max(s, 2)), at(tl.emerge)),
      setTimeout(() => feel.emit({ type: "reveal.drumroll", dur: Math.max(0.25, (at(last) - at(tl.drum)) / 1000) }), at(tl.drum)),
      setTimeout(() => {
        setStage((s) => Math.max(s, 3));
        feel.emit({ type: "reveal.verdict", bluff: reveal.bluff, at: centerOf(stampRef.current) });
      }, at(tl.verdict)),
      setTimeout(() => setStage((s) => Math.max(s, 4)), at(tl.pickup)),
      setTimeout(() => setStage((s) => Math.max(s, 5)), at(tl.pickup + 380)),
      setTimeout(() => setScrimOut(true), at(tl.settle)),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the choreography is planned once, at mount
  }, []);

  const caller = playerById(players, reveal.caller);
  const accused = playerById(players, reveal.accused);
  const picker = playerById(players, reveal.picker);
  const winner = playerById(players, reveal.winner);
  const n = reveal.cards.length;
  // Card timings are relative to the moment the cards emerge.
  const rel = (ms: number) => (at(ms) - at(tl.emerge)) / 1000;
  const avatar = desktop ? 56 : 44;

  return (
    <>
      {/* The scrim dims the table while the story plays, then lifts so the pile can be seen travelling. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: scrimOut ? 0 : 1 }}
        transition={{ duration: scrimOut ? 0.5 : 0.18 }}
        style={{ background: "radial-gradient(80% 60% at 50% 50%, hsl(var(--background) / 0.8), hsl(var(--background) / 0.94))" }}
      />

      {/* colour wash when the verdict lands */}
      {stage >= 3 && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.6, 0.22] }}
          transition={{ duration: 0.8 }}
          style={{ background: `radial-gradient(60% 45% at 50% 50%, hsl(var(${reveal.bluff ? "--bluff" : "--trust"}) / 0.45), transparent 70%)` }}
        />
      )}

      <motion.div className="relative flex items-center gap-3 sm:gap-5" animate={{ opacity: stage >= 4 ? 0 : 1, y: stage >= 4 ? -14 : 0 }} transition={{ duration: 0.28 }}>
        <motion.div initial={{ x: -80, opacity: 0, scale: 0.8 }} animate={{ x: 0, opacity: 1, scale: 1 }} transition={spring.slam}>
          {caller && (
            <div className="relative">
              <Avatar name={caller.name} color={caller.color} bot={caller.bot} size={avatar} className="ring-2 ring-bluff shadow-glow-bluff" />
              <span aria-hidden className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-bluff text-white ring-2 ring-background">
                <Megaphone className="h-3 w-3" />
              </span>
            </div>
          )}
        </motion.div>
        <div className="text-center">
          <motion.div
            initial={{ letterSpacing: "0.8em", scale: 1.6, opacity: 0 }}
            animate={{ letterSpacing: "0.24em", scale: 1, opacity: 1 }}
            transition={{ duration: 0.34, ease: ease.out }}
            className="text-[11px] font-bold uppercase text-bluff"
          >
            Bluff called
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.24 }}
            className="font-display text-base font-bold leading-tight sm:text-xl lg:text-2xl"
          >
            <span className="text-foreground">{caller?.name ?? "Someone"}</span> <span className="text-muted">calls bluff on</span>{" "}
            <span className="text-foreground">{accused?.name ?? "someone"}</span>!
          </motion.p>
        </div>
        <motion.div initial={{ x: 80, opacity: 0, scale: 0.8 }} animate={{ x: 0, opacity: 1, scale: 1 }} transition={spring.slam}>
          {accused && <Avatar name={accused.name} color={accused.color} bot={accused.bot} size={avatar} className="ring-2 ring-white/30" />}
        </motion.div>
      </motion.div>

      {stage >= 1 && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: stage >= 4 ? 0 : 1, y: 0 }}
          className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted sm:text-base"
        >
          <span>{accused?.name ?? "They"} claimed</span>
          <b className="text-foreground">
            {n} × {RANK_PLURAL[reveal.rank]}
          </b>
          <RankChip rank={reveal.rank} size="sm" />
        </motion.p>
      )}

      {stage >= 2 && (
        <div
          data-testid="reveal-cards"
          className={cn("flex flex-wrap items-start justify-center gap-2.5 transition-opacity duration-150 sm:gap-4", stage >= 4 && "opacity-0")}
        >
          {reveal.cards.map((code, i) => (
            <FlipCard
              key={code}
              code={code}
              claimed={reveal.rank}
              unit={unit}
              flipAt={rel(tl.flips[i])}
              teaseAt={i === n - 1 ? rel(tl.drum) : null}
              from={pileFrom}
              reduced={reduced}
              onFlip={(el) => feel.emit({ type: "reveal.flip", i, ok: rankOf(code) === reveal.rank, at: centerOf(el) })}
            />
          ))}
        </div>
      )}

      {stage >= 3 && (
        <motion.div
          ref={stampRef}
          initial={reduced ? { opacity: 0 } : { scale: 2.8, rotate: -18, opacity: 0 }}
          animate={
            stage >= 5
              ? { opacity: 0, scale: reduced ? 1 : 0.8, y: reduced ? 0 : -24, rotate: -5 }
              : reduced
                ? { opacity: 1 }
                : { scale: 1, rotate: -5, opacity: 1, y: 0 }
          }
          transition={stage >= 5 ? { duration: 0.32, ease: "easeIn" } : spring.slam}
        >
          <motion.div
            data-testid="reveal-verdict"
            animate={reveal.bluff && !reduced ? { x: [0, -10, 10, -7, 7, -3, 0] } : undefined}
            transition={{ delay: 0.2, duration: 0.5 }}
            className={cn(
              "rounded-2xl border-4 bg-background/70 px-6 py-1.5 font-display text-4xl font-extrabold uppercase tracking-wider text-glow sm:px-8 sm:text-5xl",
              reveal.bluff ? "border-bluff text-bluff shadow-glow-bluff" : "border-trust text-trust shadow-glow-trust",
            )}
          >
            {reveal.bluff ? "BLUFF!" : "HONEST"}
          </motion.div>
        </motion.div>
      )}

      {stage >= 4 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
          className="flex flex-col items-center gap-2"
          data-testid="reveal-result"
        >
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm sm:text-base">
            {picker && <Avatar name={picker.name} color={picker.color} bot={picker.bot} size={28} />}
            <span>
              <b>{picker?.name ?? "Someone"}</b> picks up{" "}
              <b className="text-gold">
                {reveal.pickup} card{reveal.pickup === 1 ? "" : "s"}
              </b>
            </span>
          </div>
          {winner && (
            <p className="flex items-center gap-2 font-display text-sm font-bold text-gold sm:text-base">
              <Trophy className="h-4 w-4" aria-hidden /> {winner.name} played their last cards — wins!
            </p>
          )}
        </motion.div>
      )}
    </>
  );
}

/** Full-area overlay shown while the server holds the room in "reveal". Mounted/unmounted by the status, never by its own timer. */
export function RevealOverlay({ view, serverNow, pileFrom }: { view: RoomView; serverNow: () => number; pileFrom: Point | null }) {
  const reveal = view.reveal;
  if (!reveal) return null;
  return (
    <motion.div
      data-testid="reveal-overlay"
      role="region"
      aria-label="Bluff called"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6 sm:gap-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <Body reveal={reveal} players={view.players} serverNow={serverNow} pileFrom={pileFrom} />
    </motion.div>
  );
}
