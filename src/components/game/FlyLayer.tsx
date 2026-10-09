import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FLIGHT } from "@/lib/motion";
import { useEffectsReduced } from "@/lib/prefs";
import type { CardCode } from "@/lib/types";
import { PlayingCard } from "./PlayingCard";

export interface Point {
  x: number;
  y: number;
}

/** Cards travelling between two screen points. */
export interface Flight {
  id: number;
  /** Where the cards leave from — one point for all, or one per card (e.g. their exact spots in a hand). */
  from: Point | Point[];
  /** Where they land — one point, or one per card. */
  to: Point | Point[];
  /** Number of cards (capped at 6 when rendered). */
  count: number;
  /** Pixels per em of the flying cards. */
  unit: number;
  /** What each card shows; missing/null = face-down. */
  faces?: (CardCode | null)[];
  /** Seconds before the first card leaves. */
  delay?: number;
  /** Seconds between cards (default 0.055). */
  stagger?: number;
  /** Seconds in the air (default `FLIGHT`). */
  duration?: number;
  /** Rotation each card lands with, in degrees (default: a small deterministic scatter). */
  landRotate?: number;
  /** Ghost copies behind the cards, for speed. */
  trail?: boolean;
  /** Called as each card touches down. */
  onLand?: (index: number, last: boolean) => void;
  /** Called when the whole flight is over. */
  onDone?: () => void;
}

/** A glowing dot that carries attention from one place to another (e.g. "the turn passes to…"). */
export interface Spark {
  id: number;
  from: Point;
  to: Point;
  /** CSS colour. */
  color: string;
  duration?: number;
  onDone?: () => void;
}

const MAX_CARDS = 8; // a deal wave sends one card to each of up to eight seats
const pick = (p: Point | Point[], i: number): Point => (Array.isArray(p) ? p[Math.min(i, p.length - 1)] : p);

function FlyingCard({ flight, index, ghost = 0, onDone }: { flight: Flight; index: number; ghost?: number; onDone: () => void }) {
  const from = pick(flight.from, index);
  const to = pick(flight.to, index);
  const { unit } = flight;
  const w = unit * 5;
  const h = unit * 7;
  const D = flight.duration ?? FLIGHT;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(120, 26 + dist * 0.22);
  // A small, deterministic scatter so a handful of cards fan out instead of stacking exactly.
  const n = Math.min(flight.count, MAX_CARDS);
  const spread = (index - (n - 1) / 2) * 8;
  const seed = (flight.id * 13 + index * 7) % 11;
  const r1 = flight.landRotate ?? (index - (n - 1) / 2) * 7 + seed - 5;
  const r0 = r1 * 2.2 + (index % 2 ? 9 : -9);
  const apexY = (from.y + to.y) / 2 - lift;
  const delay = (flight.delay ?? 0) + index * (flight.stagger ?? 0.055) + ghost;
  const face = flight.faces?.[index] ?? null;
  const opacity = ghost === 0 ? 1 : ghost > 0.04 ? 0.18 : 0.34;
  return (
    <motion.div
      className="absolute left-0 top-0 will-change-transform"
      style={{ filter: ghost === 0 ? "drop-shadow(0 10px 14px rgb(0 0 0 / .45))" : undefined }}
      initial={{ x: from.x - w / 2 + spread, y: from.y - h / 2, rotate: r0, scale: 0.88, opacity: 0 }}
      animate={{
        x: to.x - w / 2 + spread * 0.35,
        y: [from.y - h / 2, apexY - h / 2, to.y - h / 2],
        rotate: r1,
        scale: [0.88, 1.12, 1],
        opacity: [0, opacity, opacity],
      }}
      transition={{
        delay,
        x: { duration: D, ease: [0.25, 0.6, 0.35, 1] },
        y: { duration: D, times: [0, 0.46, 1], ease: ["easeOut", "easeIn"] },
        rotate: { duration: D, ease: [0.25, 0.6, 0.35, 1] },
        scale: { duration: D, times: [0, 0.46, 1], ease: ["easeOut", "easeIn"] },
        opacity: { duration: 0.12, times: [0, 0.5, 1] },
      }}
      onAnimationComplete={ghost === 0 ? onDone : undefined}
      data-flying-card={ghost === 0 ? "" : undefined}
    >
      {ghost > 0 ? (
        // trail ghosts are just the card's silhouette — no need to draw its artwork three times
        <div
          className={face === null ? "leery-card-back" : "bg-gradient-to-br from-white via-ivory to-[#e7dfca]"}
          style={{ width: "5em", height: "7em", fontSize: unit, borderRadius: "0.6em" }}
        />
      ) : (
        <PlayingCard faceDown={face === null} code={face ?? undefined} unit={unit} />
      )}
    </motion.div>
  );
}

function FlightView({ flight, onDone }: { flight: Flight; onDone: (id: number) => void }) {
  const reduced = useEffectsReduced();
  const n = Math.min(flight.count, MAX_CARDS);
  // Latest callbacks, without re-running the effect when the parent re-renders.
  const cb = useMemo(() => ({ land: flight.onLand, done: flight.onDone }), [flight.onLand, flight.onDone]);
  const landed = useRef(0);

  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(() => {
      for (let i = 0; i < n; i++) cb.land?.(i, i === n - 1);
      cb.done?.();
      onDone(flight.id);
    }, 0);
    return () => window.clearTimeout(t);
  }, [reduced, n, cb, onDone, flight.id]);

  if (reduced) return null;
  const landOne = (i: number) => {
    landed.current += 1;
    cb.land?.(i, landed.current === n);
    if (landed.current === n) {
      cb.done?.();
      onDone(flight.id);
    }
  };
  return (
    <>
      {flight.trail &&
        Array.from({ length: n }, (_, i) => [0.03, 0.06].map((g) => <FlyingCard key={`${flight.id}-${i}-g${g}`} flight={flight} index={i} ghost={g} onDone={() => undefined} />))}
      {Array.from({ length: n }, (_, i) => (
        <FlyingCard key={`${flight.id}-${i}`} flight={flight} index={i} onDone={() => landOne(i)} />
      ))}
    </>
  );
}

function SparkView({ spark, onDone }: { spark: Spark; onDone: (id: number) => void }) {
  const reduced = useEffectsReduced();
  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(() => {
      spark.onDone?.();
      onDone(spark.id);
    }, 0);
    return () => window.clearTimeout(t);
  }, [reduced, spark, onDone]);
  if (reduced) return null;
  const D = spark.duration ?? 0.42;
  const dist = Math.hypot(spark.to.x - spark.from.x, spark.to.y - spark.from.y);
  const midY = (spark.from.y + spark.to.y) / 2 - Math.min(70, dist * 0.18);
  return (
    <>
      {[0.07, 0.035, 0].map((g, i) => (
        <motion.span
          key={`${spark.id}-${i}`}
          className="absolute left-0 top-0 block rounded-full will-change-transform"
          style={{ width: 12 - i * 2.5, height: 12 - i * 2.5, marginLeft: -6 + i * 1.25, marginTop: -6 + i * 1.25, background: spark.color, boxShadow: `0 0 ${14 - i * 3}px ${spark.color}`, opacity: 0 }}
          initial={{ x: spark.from.x, y: spark.from.y, scale: 0.6, opacity: 0 }}
          animate={{ x: spark.to.x, y: [spark.from.y, midY, spark.to.y], scale: [0.6, 1.25, 0.9], opacity: [0, 1, 0.9, 0] }}
          transition={{
            delay: g,
            x: { duration: D, ease: [0.3, 0.1, 0.25, 1] },
            y: { duration: D, times: [0, 0.5, 1], ease: ["easeOut", "easeIn"] },
            scale: { duration: D, times: [0, 0.5, 1] },
            opacity: { duration: D, times: [0, 0.15, 0.8, 1] },
          }}
          onAnimationComplete={i === 2 ? () => (spark.onDone?.(), onDone(spark.id)) : undefined}
        />
      ))}
    </>
  );
}

/** Fixed, click-through layer that renders flights and sparks and reports each one finished. */
export function FlyLayer({
  flights,
  sparks = [],
  onDone,
  onSparkDone,
}: {
  flights: Flight[];
  sparks?: Spark[];
  onDone: (id: number) => void;
  onSparkDone?: (id: number) => void;
}) {
  if (typeof document === "undefined" || (flights.length === 0 && sparks.length === 0)) return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {flights.map((f) => (
        <FlightView key={f.id} flight={f} onDone={onDone} />
      ))}
      {sparks.map((s) => (
        <SparkView key={s.id} spark={s} onDone={onSparkDone ?? (() => undefined)} />
      ))}
    </div>,
    document.body,
  );
}
