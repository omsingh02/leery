import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { feel } from "@/lib/feel";
import { rankOf } from "@/lib/game";
import { useEffectsReduced } from "@/lib/prefs";
import type { CardCode, Rank } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Point } from "./FlyLayer";
import { layoutHand, LIFT_ROOM } from "./handLayout";
import { PlayingCard } from "./PlayingCard";
import "./game.css";

export type DragState = "idle" | "dragging" | "armed";

/** Where a card that just arrived in the hand came from, as an offset from its slot. */
export interface Arrival {
  dx: number;
  dy: number;
  rot?: number;
}

interface HandProps {
  /** My cards, already sorted. */
  cards: readonly CardCode[];
  /** Currently selected card codes. */
  selected: readonly CardCode[];
  onToggle: (code: CardCode) => void;
  /** Cards of this rank get a small gold marker (the honest-play hint). */
  requiredRank?: Rank | null;
  /** false → cards are shown but can't be toggled (e.g. during a reveal). */
  interactive?: boolean;
  maxSelect?: number;
  /** Called when the player tries to select more than `maxSelect` cards. */
  onLimit?: () => void;
  /** Short viewport: smaller cards so everything still fits without scrolling. */
  compact?: boolean;
  /** Cards that just arrived (picked-up pile, the deal) and where from: they glide into their slots. */
  arrivals?: { codes: readonly CardCode[]; from: Point } | null;
  /** Bump to ripple a little "your turn" wave through the fan. */
  waveKey?: number;
  /** Drag cards up onto the table to play them. */
  drag?: {
    enabled: boolean;
    /** "2 as Sevens" — what releasing will do. */
    label: string;
    /** Released past the line: play these. Called with the cards at their dragged positions. */
    onPlay: (cards: CardCode[]) => void;
    onState?: (state: DragState) => void;
  };
  className?: string;
}

interface HandCardProps {
  code: CardCode;
  index: number;
  x: number;
  y: number;
  cardW: number;
  cardH: number;
  unit: number;
  selected: boolean;
  highlighted: boolean;
  interactive: boolean;
  shaking: boolean;
  tabbable: boolean;
  dragging: boolean;
  returning: boolean;
  dragEnabled: boolean;
  arrival: Arrival | undefined;
  arrivalIndex: number;
  onToggle: (code: CardCode) => void;
  onFocusIndex: (index: number) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>, code: CardCode) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (e: PointerEvent<HTMLButtonElement>) => void;
  register: (code: CardCode, el: HTMLElement | null) => void;
}

/** A stable little lean for a picked card, so a selection looks hand-picked, not machine-aligned. */
const tiltOf = (code: CardCode): number => {
  let h = 7;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 9) - 4) * 0.55;
};

/** One card in the fan. Memoised so selecting a card only re-renders that card. */
const HandCard = memo(function HandCard(p: HandCardProps) {
  const { code, index, register } = p;
  // How this card first appeared is fixed at mount: changing the class later would replay the animation.
  const entrance = useRef<{ className: string; style: React.CSSProperties } | null>(null);
  if (entrance.current === null) {
    entrance.current = p.arrival
      ? {
          className: "animate-arrive",
          style: { "--ax": `${p.arrival.dx}px`, "--ay": `${p.arrival.dy}px`, "--ar": `${p.arrival.rot ?? 0}deg`, animationDelay: `${Math.min(p.arrivalIndex * 55, 440)}ms` } as React.CSSProperties,
        }
      : { className: "animate-pop-in", style: { animationDelay: `${Math.min(index * 16, 360)}ms` } };
  }
  return (
    <div
      className="absolute left-0 top-0"
      style={{
        width: p.cardW,
        height: p.cardH,
        zIndex: p.dragging ? 100 + index : index + 1,
        transform: `translate(${p.x}px, ${p.y + LIFT_ROOM}px)`,
        transition: "transform 300ms cubic-bezier(.22,1,.36,1)",
      }}
    >
      {/* Wrappers so the mount animation, the limit shake, the drag and the selection lift never fight over `transform`. */}
      <div className={entrance.current.className} style={entrance.current.style}>
        <div className={p.shaking ? "animate-shake" : undefined}>
          <div className={cn(p.dragging && "hand-drag-layer", p.returning && "hand-drag-return")}>
            <PlayingCard
              ref={(el) => register(code, el)}
              code={code}
              unit={p.unit}
              selected={p.selected}
              highlighted={p.highlighted}
              disabled={!p.interactive}
              tabIndex={p.tabbable ? 0 : -1}
              style={{ ["--tilt" as string]: p.selected ? `${tiltOf(code)}deg` : "0deg", touchAction: p.dragEnabled ? "none" : undefined }}
              onClick={() => p.onToggle(code)}
              onFocus={() => p.onFocusIndex(index)}
              onKeyDown={(e) => p.onKey(e, index)}
              onPointerDown={(e) => p.onPointerDown(e, code)}
              onPointerMove={p.onPointerMove}
              onPointerUp={p.onPointerEnd}
              onPointerCancel={p.onPointerEnd}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

const EMPTY: ReadonlySet<CardCode> = new Set();

/**
 * My hand as an overlapping fan that fits its container: 1–3 rows, each row's overlap computed to
 * span the row exactly, so even 30+ cards stay tappable on a phone. Cards are absolutely positioned
 * with stable keys, so the fan re-flows smoothly instead of re-mounting when the hand changes.
 *
 * Feel: tap to pick (a rising note per card), a 5th card says "no", pulled-up cards can be dragged
 * onto the table to play, new cards glide in from wherever they came from.
 */
export const Hand = memo(function Hand({
  cards,
  selected,
  onToggle,
  requiredRank = null,
  interactive = true,
  maxSelect = 4,
  onLimit,
  compact = false,
  arrivals,
  waveKey = 0,
  drag,
  className,
}: HandProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<CardCode, HTMLElement>());
  const [width, setWidth] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [shaking, setShaking] = useState<CardCode | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduced = useEffectsReduced();

  // ---- drag state ----------------------------------------------------------------------------------------
  const [dragSet, setDragSet] = useState<ReadonlySet<CardCode>>(EMPTY);
  const [phase, setPhase] = useState<"idle" | "drag" | "return">("idle");
  const [dragState, setDragState] = useState<DragState>("idle");
  const press = useRef<{ id: number; x: number; y: number; code: CardCode; active: boolean; armed: boolean; set: CardCode[] } | null>(null);
  const suppressClick = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      clearTimeout(shakeTimer.current);
      clearTimeout(returnTimer.current);
    },
    [],
  );

  const sel = useMemo(() => new Set(selected), [selected]);
  const layout = useMemo(() => (width > 0 ? layoutHand(cards.length, width, compact) : null), [cards.length, width, compact]);
  const activeIdx = Math.min(focusIdx, Math.max(0, cards.length - 1));

  // Latest values behind stable callbacks, so memoised cards don't re-render when they change.
  const latest = useRef({ sel, interactive, maxSelect, onLimit, onToggle, cards, layout, drag });
  useEffect(() => {
    latest.current = { sel, interactive, maxSelect, onLimit, onToggle, cards, layout, drag };
  });

  const toggle = useCallback((code: CardCode) => {
    const s = latest.current;
    if (!s.interactive || suppressClick.current) return;
    if (!s.sel.has(code)) {
      if (s.sel.size >= s.maxSelect) {
        s.onLimit?.();
        feel.emit({ type: "card.limit" });
        setShaking(code);
        clearTimeout(shakeTimer.current);
        shakeTimer.current = setTimeout(() => setShaking(null), 450);
        return;
      }
      feel.emit({ type: "card.select", n: s.sel.size + 1 });
    } else {
      feel.emit({ type: "card.deselect", n: s.sel.size - 1 });
    }
    s.onToggle(code);
  }, []);

  const register = useCallback((code: CardCode, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(code, el);
    else cardRefs.current.delete(code);
  }, []);

  // ---- drag to play ------------------------------------------------------------------------------------------
  const setVars = (dx: number, dy: number) => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty("--drag-x", `${dx}px`);
    el.style.setProperty("--drag-y", `${dy}px`);
    el.style.setProperty("--drag-r", `${Math.max(-9, Math.min(9, dx * 0.05))}deg`);
  };

  const endDrag = useCallback((play: boolean) => {
    const pr = press.current;
    press.current = null;
    if (!pr?.active) return;
    const s = latest.current;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 160);
    setDragState("idle");
    s.drag?.onState?.("idle");
    if (play && pr.armed) {
      // Hand over at the dragged positions (the caller measures them), then clear.
      s.drag?.onPlay(pr.set);
      setPhase("idle");
      setDragSet(EMPTY);
      setVars(0, 0);
      return;
    }
    // Not far enough: spring back.
    setPhase("return");
    setVars(0, 0);
    clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => {
      setPhase("idle");
      setDragSet(EMPTY);
    }, 320);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>, code: CardCode) => {
    const s = latest.current;
    if (!s.drag?.enabled || !s.interactive || (e.pointerType === "mouse" && e.button !== 0)) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, code, active: false, armed: false, set: [] };
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const pr = press.current;
    if (!pr || pr.id !== e.pointerId) return;
    const s = latest.current;
    const dx = e.clientX - pr.x;
    const dy = e.clientY - pr.y;
    if (!pr.active) {
      if (dy < -12 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        // Start dragging: the picked cards, plus the pressed one if there's room for it.
        const picked = [...s.sel];
        if (!s.sel.has(pr.code)) {
          if (s.sel.size >= s.maxSelect) {
            press.current = null;
            return;
          }
          feel.emit({ type: "card.select", n: s.sel.size + 1 });
          s.onToggle(pr.code);
          picked.push(pr.code);
        }
        pr.active = true;
        pr.set = picked;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
        clearTimeout(returnTimer.current);
        setDragSet(new Set(picked));
        setPhase("drag");
        setDragState("dragging");
        s.drag?.onState?.("dragging");
      }
      return;
    }
    const line = Math.max(84, Math.min(140, (s.layout?.cardH ?? 90) * 1.05));
    setVars(dx, Math.max(-280, Math.min(30, dy)));
    const armed = dy <= -line;
    if (armed !== pr.armed) {
      pr.armed = armed;
      setDragState(armed ? "armed" : "dragging");
      s.drag?.onState?.(armed ? "armed" : "dragging");
      feel.emit({ type: armed ? "drag.arm" : "drag.disarm" });
    }
  }, []);

  const onPointerEnd = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const pr = press.current;
      if (!pr || pr.id !== e.pointerId) return;
      if (!pr.active) {
        press.current = null;
        return;
      }
      endDrag(e.type === "pointerup");
    },
    [endDrag],
  );

  // The drag must not outlive its cards (e.g. the turn ends mid-drag).
  useEffect(() => {
    if (drag?.enabled && interactive) return;
    if (press.current?.active) endDrag(false);
    press.current = null;
  }, [drag?.enabled, interactive, endDrag]);

  // ---- "your turn" wave -------------------------------------------------------------------------------------
  useEffect(() => {
    if (!waveKey || reduced) return;
    const list = latest.current.cards;
    list.forEach((code, i) => {
      const el = cardRefs.current.get(code)?.parentElement;
      el?.animate?.([{ transform: "translateY(0)" }, { transform: "translateY(-9px)", offset: 0.4 }, { transform: "translateY(0)" }], {
        duration: 420,
        delay: Math.min(i * 18, 360),
        easing: "ease-out",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the key bumps
  }, [waveKey]);

  const onKey = useCallback((e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const { layout: l, cards: list } = latest.current;
    if (!l) return;
    const focusAt = (target: number) => {
      const idx = Math.max(0, Math.min(list.length - 1, target));
      setFocusIdx(idx);
      cardRefs.current.get(list[idx])?.focus();
    };
    const row = l.rowOf[i];
    const col = i - l.rowStarts[row];
    const toRow = (r: number) => {
      if (r < 0 || r >= l.rowStarts.length) return i;
      const start = l.rowStarts[r];
      const end = r + 1 < l.rowStarts.length ? l.rowStarts[r + 1] : list.length;
      return Math.min(end - 1, start + col);
    };
    switch (e.key) {
      case "ArrowRight": e.preventDefault(); focusAt(i + 1); break;
      case "ArrowLeft": e.preventDefault(); focusAt(i - 1); break;
      case "ArrowUp": e.preventDefault(); focusAt(toRow(row - 1)); break;
      case "ArrowDown": e.preventDefault(); focusAt(toRow(row + 1)); break;
      case "Home": e.preventDefault(); focusAt(0); break;
      case "End": e.preventDefault(); focusAt(list.length - 1); break;
      default: break;
    }
  }, []);

  // Offsets from each arriving card's slot back to where it came from (computed against the hand's current position).
  const arriving = useMemo(() => {
    const out = new Map<CardCode, { arrival: Arrival; index: number }>();
    if (!arrivals || !layout || reduced) return out;
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return out;
    const set = new Set(arrivals.codes);
    let k = 0;
    cards.forEach((code, i) => {
      if (!set.has(code)) return;
      const cx = r.left + layout.positions[i].x + layout.cardW / 2;
      const cy = r.top + LIFT_ROOM + layout.positions[i].y + layout.cardH / 2;
      out.set(code, { arrival: { dx: arrivals.from.x - cx, dy: arrivals.from.y - cy, rot: ((k % 5) - 2) * 14 }, index: k });
      k += 1;
    });
    return out;
  }, [arrivals, cards, layout, reduced]);

  return (
    <div
      ref={wrapRef}
      data-testid="hand"
      role="group"
      aria-label={`Your hand, ${cards.length} card${cards.length === 1 ? "" : "s"}`}
      className={cn("relative w-full", className)}
      style={{ height: layout ? layout.height + LIFT_ROOM : LIFT_ROOM + (compact ? 64 : 80) }}
    >
      {dragState !== "idle" && drag && (
        <div
          aria-hidden
          data-testid="drag-hint"
          className={cn(
            "pointer-events-none absolute left-1/2 top-0 z-[120] -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg backdrop-blur transition-colors",
            dragState === "armed" ? "bg-gold text-ink shadow-glow-gold" : "border border-white/15 bg-background/85 text-foreground",
          )}
        >
          {dragState === "armed" ? `Release to play ${drag.label}` : "Drag up to play"}
        </div>
      )}
      {layout &&
        cards.map((code, i) => (
          <HandCard
            key={code}
            code={code}
            index={i}
            x={layout.positions[i].x}
            y={layout.positions[i].y}
            cardW={layout.cardW}
            cardH={layout.cardH}
            unit={layout.unit}
            selected={sel.has(code)}
            highlighted={requiredRank != null && rankOf(code) === requiredRank}
            interactive={interactive}
            shaking={shaking === code}
            tabbable={i === activeIdx}
            dragging={dragSet.has(code) && phase !== "idle"}
            returning={dragSet.has(code) && phase === "return"}
            dragEnabled={!!drag?.enabled && interactive}
            arrival={arriving.get(code)?.arrival}
            arrivalIndex={arriving.get(code)?.index ?? 0}
            onToggle={toggle}
            onFocusIndex={setFocusIdx}
            onKey={onKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerEnd={onPointerEnd}
            register={register}
          />
        ))}
    </div>
  );
});
