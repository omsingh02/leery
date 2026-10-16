import { forwardRef, memo, useEffect } from "react";
import { motion, useAnimate } from "framer-motion";
import { spring } from "@/lib/motion";
import { useEffectsReduced } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { PlayingCard } from "./PlayingCard";
import "./game.css";

interface PileProps {
  /** Cards in the pile. */
  count: number;
  /** Pixels per em of the cards (card = 5em × 7em). */
  unit?: number;
  /** Bump this number whenever cards land on the pile: the whole stack takes the hit. */
  impact?: number;
  /** A drag is hovering over the pile, ready to be dropped (lights the pile up). */
  dropActive?: boolean;
  className?: string;
}

/** Deterministic "messy stack" jitter so the pile looks hand-tossed but never flickers between renders. */
const jitter = (i: number) => ({
  rot: (((i * 37 + 11) % 19) - 9) * 1.15,
  dx: (((i * 53 + 7) % 13) - 6) * 1.5,
  dy: (((i * 29 + 3) % 9) - 4) * 1.25,
});

const MAX_SHOWN = 8;

/** The face-down centre pile: a loose stack of card backs with a big count badge. */
export const Pile = memo(
  forwardRef<HTMLDivElement, PileProps>(function Pile({ count, unit = 11, impact = 0, dropActive = false, className }, ref) {
    const shown = Math.min(count, MAX_SHOWN);
    const w = unit * 5;
    const h = unit * 7;
    const tight = unit <= 10; // short screens: less breathing room around the stack
    const reduced = useEffectsReduced();
    const [scope, animate] = useAnimate();

    // Cards landing: the stack compresses and rebounds, like something with weight just hit it.
    useEffect(() => {
      if (!impact || reduced || !scope.current) return;
      void animate(scope.current, { scale: [1, 0.935, 1.03, 1], y: [0, 5, -1.5, 0] }, { duration: 0.36, times: [0, 0.26, 0.62, 1], ease: "easeOut" });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the impact counter only
    }, [impact]);

    return (
      <div
        ref={ref}
        data-testid="pile"
        className={cn("relative grid shrink-0 place-items-center", className)}
        style={{ width: w + (tight ? 22 : 36), height: h + (tight ? 12 : 26) }}
      >
        {/* contact shadow, wider the taller the pile */}
        {count > 0 && (
          <span
            aria-hidden
            className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[50%] bg-black/55 blur-md"
            style={{ width: w * (0.9 + Math.min(count, MAX_SHOWN) * 0.025), height: h * 0.14 }}
          />
        )}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -m-2 rounded-[1.2em] opacity-0 transition-opacity duration-200",
            dropActive && "opacity-100 ring-2 ring-gold shadow-[0_0_34px_hsl(var(--gold)/0.55)]",
          )}
        />
        <div ref={scope} className="relative grid place-items-center" style={{ width: w + 24, height: h + 16 }}>
          {count === 0 ? (
            <div
              className="grid place-items-center rounded-[0.6em] border-2 border-dashed border-white/20 text-center text-[11px] font-semibold uppercase tracking-widest text-white/40"
              style={{ fontSize: unit, width: "5em", height: "7em" }}
            >
              <span style={{ fontSize: 11 }}>Empty</span>
            </div>
          ) : (
            Array.from({ length: shown }, (_, i) => {
              const { rot, dx, dy } = jitter(i);
              const top = i === shown - 1;
              return (
                <div
                  key={i}
                  className="absolute"
                  style={{ transform: `translate(${dx}px, ${dy - i * 0.9}px) rotate(${top ? -2 : rot}deg)` }}
                >
                  <PlayingCard faceDown unit={unit} />
                </div>
              );
            })
          )}
        </div>
        <motion.span
          key={count}
          data-testid="pile-count"
          aria-label={`${count} cards in the pile`}
          initial={impact || count > 0 ? { scale: 1.45 } : false}
          animate={{ scale: 1 }}
          transition={spring.pop}
          className="absolute -bottom-0.5 right-0 min-w-[2rem] rounded-full border border-white/15 bg-background/85 px-2.5 py-0.5 text-center font-display text-sm font-bold tabular-nums text-foreground shadow-lg backdrop-blur"
        >
          {count}
        </motion.span>
      </div>
    );
  }),
);
