import {
  forwardRef,
  memo,
  type CSSProperties,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type Ref,
} from "react";
import { Crown } from "lucide-react";
import { cardLabel, isRedSuit, rankOf, suitOf } from "@/lib/game";
import type { CardCode, Rank, Suit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/shell/Logo";
import { CARD_UNIT, PIP_LAYOUT, type CardSize } from "./cardMetrics";
import { SuitIcon } from "./Suit";
import "./game.css";

export interface PlayingCardProps {
  /** Required for face-up cards. */
  code?: CardCode;
  faceDown?: boolean;
  selected?: boolean;
  /** Required-rank hint: a small gold marker on the card's top edge. */
  highlighted?: boolean;
  disabled?: boolean;
  size?: CardSize;
  /** Exact pixels-per-em (a card is 5em × 7em). Overrides `size`. */
  unit?: number;
  /** Makes the card an interactive toggle button. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
}

/** Index in the corner: rank above suit. The bottom-right one is the same thing rotated 180°. */
function Corner({ rank, suit, flipped }: { rank: Rank; suit: Suit; flipped?: boolean }) {
  const ten = rank === "10";
  return (
    <div
      className={cn(
        "absolute flex flex-col items-center leading-none",
        flipped ? "bottom-[0.32em] right-[0.34em] rotate-180" : "left-[0.34em] top-[0.32em]",
      )}
    >
      <span className={cn("font-bold", ten && "tracking-[-0.14em]")} style={{ fontSize: ten ? "1.02em" : "1.18em" }}>
        {rank}
      </span>
      <SuitIcon suit={suit} className="mt-[0.1em] h-[0.8em] w-[0.8em]" />
    </div>
  );
}

const FACE_ORNAMENT: Partial<Record<Rank, "crown" | "none">> = { K: "crown", Q: "crown" };

function CardFace({ rank, suit }: { rank: Rank; suit: Suit }) {
  const pips = PIP_LAYOUT[rank];
  const isFace = rank === "J" || rank === "Q" || rank === "K";

  return (
    <>
      <Corner rank={rank} suit={suit} />
      <Corner rank={rank} suit={suit} flipped />

      {rank === "A" && (
        <SuitIcon
          suit={suit}
          className="absolute left-1/2 top-1/2 h-[2.7em] w-[2.7em] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0.08em_0.12em_rgb(0_0_0/.25)]"
        />
      )}

      {pips && (
        <div className="absolute inset-x-[1.95em] inset-y-[0.95em]">
          {pips.map(([x, y], i) => (
            <SuitIcon
              key={i}
              suit={suit}
              className={cn(
                "absolute h-[0.84em] w-[0.84em] -translate-x-1/2 -translate-y-1/2",
                y > 0.5 && "rotate-180",
              )}
              // positioned by percentage inside the pip field
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          ))}
        </div>
      )}

      {isFace && (
        <div className="absolute inset-x-[1.35em] inset-y-[0.95em] flex flex-col items-center justify-between rounded-[0.4em] border border-current/30 bg-gradient-to-b from-current/[0.05] via-current/[0.11] to-current/[0.05] py-[0.35em]">
          <SuitIcon suit={suit} className="h-[0.9em] w-[0.9em] opacity-80" />
          <div className="relative flex flex-col items-center">
            {FACE_ORNAMENT[rank] === "crown" && <Crown className="mb-[0.1em] h-[0.95em] w-[0.95em] opacity-70" aria-hidden />}
            <span className="font-display font-extrabold leading-none" style={{ fontSize: "2.7em" }}>
              {rank}
            </span>
          </div>
          <SuitIcon suit={suit} className="h-[0.9em] w-[0.9em] rotate-180 opacity-80" />
        </div>
      )}
    </>
  );
}

/** Every face-down card carries the brand's side-eye: someone is watching. */
function CardBack({ unit }: { unit: number }) {
  return (
    <>
      <span className="absolute inset-[0.42em] rounded-[0.38em] border border-primary/60" />
      <span className="absolute inset-0 grid place-items-center">
        {unit >= 5 && <LogoMark tile={false} size="3.1em" className="drop-shadow-[0_0_0.45em_hsl(var(--primary)/0.85)]" />}
      </span>
    </>
  );
}

/**
 * A playing card drawn entirely in CSS/SVG. Everything inside is in `em`, so the whole card scales
 * from `size`/`unit`. Renders a `<button>` when `onClick` is given (selectable card), else a plain box.
 */
const PlayingCardBase = forwardRef<HTMLElement, PlayingCardProps>(function PlayingCard(
  {
    code,
    faceDown,
    selected,
    highlighted,
    disabled,
    size = "md",
    unit,
    onClick,
    className,
    style,
    tabIndex,
    onKeyDown,
    onFocus,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  },
  ref,
) {
  const px = unit ?? CARD_UNIT[size];
  const showBack = faceDown || !code;
  const rank = code ? rankOf(code) : "A";
  const suit = code ? suitOf(code) : "S";
  const tiny = px < 7;

  const rootClass = cn(
    "relative block shrink-0 rounded-[0.6em] no-select",
    "[transform:translateY(var(--lift,0px))_rotate(var(--tilt,0deg))_scale(var(--press,1))] transition-[transform,box-shadow] duration-200 [transition-timing-function:cubic-bezier(.22,1.25,.36,1)]",
    showBack
      ? cn("leery-card-back ring-1 ring-primary/45", tiny ? "shadow-[0_2px_5px_rgb(0_0_0/.55)]" : "shadow-[0_6px_14px_-4px_rgb(0_0_0/.75),0_0_14px_-4px_hsl(var(--primary)/.55)]")
      : cn(
          "bg-gradient-to-br from-white via-ivory to-[#e7dfca] shadow-card",
          isRedSuit(suit) ? "text-crimson" : "text-ink",
        ),
    selected && "[--lift:-14px]",
    !selected && onClick && !disabled && "[@media(hover:hover)]:hover:[--lift:-6px]",
    onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
    onClick && !disabled && "active:[--press:0.96]",
    className,
  );

  const rootStyle: CSSProperties = { fontSize: px, width: "5em", height: "7em", ...style };

  const inner = (
    <>
      {showBack ? <CardBack unit={px} /> : <CardFace rank={rank} suit={suit} />}
      {highlighted && !showBack && (
        <span className="pointer-events-none absolute inset-x-[0.9em] top-0 h-[0.3em] rounded-b-[0.3em] bg-gold shadow-[0_0_0.8em_hsl(var(--gold)/0.95)]" />
      )}
      {selected && (
        <span className="pointer-events-none absolute -inset-px rounded-[0.62em] ring-2 ring-primary shadow-[0_0_1.5em_hsl(var(--primary)/0.85)]" />
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        ref={ref as Ref<HTMLButtonElement>}
        className={rootClass}
        style={rootStyle}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        disabled={disabled}
        tabIndex={tabIndex}
        aria-pressed={selected ?? false}
        aria-label={code ? cardLabel(code) : "Card"}
        data-testid={code && !showBack ? `card-${code}` : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      className={rootClass}
      style={rootStyle}
      role={showBack ? undefined : "img"}
      aria-hidden={showBack ? true : undefined}
      aria-label={showBack || !code ? undefined : cardLabel(code)}
      data-testid={code && !showBack ? `card-${code}` : undefined}
    >
      {inner}
    </div>
  );
});

export const PlayingCard = memo(PlayingCardBase);
