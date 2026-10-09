import { useMemo, type CSSProperties, type ReactNode, type Ref } from "react";
import { opponentsInOrder, rankOf } from "@/lib/game";
import type { PlayerView, Rank, RoomView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { myNextTurn } from "./myNext";
import { PhaseBanner } from "./PhaseBanner";
import { Pile } from "./Pile";
import { RankDial } from "./RankDial";
import { Seat, type SeatReaction, type SeatRole, type SeatVariant } from "./Seat";
import { arcPositions } from "./seatLayout";
import { useMediaQuery } from "./useMediaQuery";
import "./game.css";

interface TableProps {
  view: RoomView;
  serverNow: () => number;
  /** Attached to the pile so the screen can animate cards flying to it. */
  pileRef: Ref<HTMLDivElement>;
  /** Lets the screen find a seat's DOM node (for flying-card animations). */
  registerSeat: (id: string, el: HTMLElement | null) => void;
  /** Bumps whenever cards land on the pile. */
  pileImpact?: number;
  /** A drag is hovering over the pile. */
  dropActive?: boolean;
  /** One-shot seat animations (just threw cards, just accepted). */
  reactions?: Record<string, SeatReaction>;
  /** A seat's hand count is counting up (for tick sounds). */
  onCountStep?: (step: number, id: string) => void;
  /** The opening deal: counts change quietly. */
  quietCounts?: boolean;
  /** Rendered below the felt: my bar, hand and actions. */
  children?: ReactNode;
}

interface SeatState {
  active: boolean;
  role: SeatRole;
  tag: string | null;
  accepted: boolean;
  claim: { count: number; rank: Rank } | null;
  challengeDeadline: number | null;
}

/** What each opponent is doing right now, derived from the current phase. */
function seatState(view: RoomView, p: PlayerView): SeatState {
  const { status, turn, challenge, reveal } = view;
  let role: SeatRole = null;
  let tag: string | null = null;

  let claim: SeatState["claim"] = null;
  let challengeDeadline: number | null = null;
  if (status === "challenge" && challenge?.by === p.id) {
    role = "accused";
    tag = `played ×${challenge.count}`;
    claim = { count: challenge.count, rank: challenge.rank };
    challengeDeadline = challenge.deadline;
  }
  if (status === "reveal" && reveal) {
    if (reveal.caller === p.id) {
      role = "caller";
      tag = "called bluff";
    } else if (reveal.accused === p.id) {
      role = "accused";
      tag = "accused";
    }
    if (reveal.picker === p.id) {
      role = "picker";
      tag = `picks up ${reveal.pickup}`;
    }
  }
  return {
    active: status === "turn" && turn?.player === p.id,
    role,
    tag,
    accepted: status === "challenge" && !!challenge?.passed.includes(p.id),
    claim,
    challengeDeadline,
  };
}

/**
 * The table: opponents around the top, the felt in the middle with the pile and the phase banner,
 * and (via `children`) my own bar, hand and actions underneath.
 * Phones: opponents wrap in a rail above the felt. ≥ lg: they sit on an arc around the felt.
 */
export function Table({ view, serverNow, pileRef, registerSeat, pileImpact = 0, dropActive = false, reactions, onCountStep, quietCounts, children }: TableProps) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const short = useMediaQuery("(max-height: 700px)");
  const opponents = useMemo(() => opponentsInOrder(view.players, view.me.id), [view.players, view.me.id]);
  const n = opponents.length;

  const arcLayout = desktop && !short;
  const variant: SeatVariant = short
    ? "mini"
    : arcLayout
      ? n >= 6 ? "compact" : n >= 5 ? "default" : "large"
      : n >= 5 ? "compact" : "default";
  const turnSince = view.status === "turn" ? view.turn?.since : undefined;
  const turnDeadline = view.status === "turn" ? (view.turn?.deadline ?? null) : null;

  const renderSeat = (p: PlayerView, style?: CSSProperties) => {
    const st = seatState(view, p);
    return (
      <Seat
        key={p.id}
        ref={(el) => registerSeat(p.id, el)}
        player={p}
        serverNow={serverNow}
        variant={variant}
        active={st.active}
        turnSince={turnSince}
        deadline={st.active ? turnDeadline : null}
        role={st.role}
        accepted={st.accepted}
        tag={st.tag}
        claimCount={st.claim?.count ?? null}
        claimRank={st.claim?.rank ?? null}
        challengeDeadline={st.challengeDeadline}
        reaction={reactions?.[p.id] ?? null}
        onCountStep={onCountStep}
        quietCounts={quietCounts}
        style={style}
      />
    );
  };

  // The dial: the claimed rank, where my own cards are, and what I'll be claiming next.
  const dialRank = view.status === "turn" ? view.turn?.rank : view.status === "challenge" ? view.challenge?.rank : view.status === "reveal" ? view.reveal?.rank : undefined;
  const mine = useMemo(() => {
    const out: Partial<Record<Rank, number>> = {};
    for (const c of view.me.hand) out[rankOf(c)] = (out[rankOf(c)] ?? 0) + 1;
    return out;
  }, [view.me.hand]);
  const next = myNextTurn(view);

  const arcStyles = useMemo<CSSProperties[]>(
    () =>
      arcPositions(n).map((a) => ({ position: "absolute", left: `${a.x}%`, top: `${a.y}%`, transform: "translate(-50%, -50%)" })),
    [n],
  );

  const feltContent = (
    <>
      {dialRank && !short && <RankDial rank={dialRank} mine={mine} mark={next && next.turnsAway > 0 ? next.rank : null} />}
      <PhaseBanner view={view} serverNow={serverNow} />
      <Pile ref={pileRef} count={view.pile} impact={pileImpact} dropActive={dropActive} unit={arcLayout ? 15 : short ? (desktop ? 10 : 8) : 13} />
    </>
  );

  if (arcLayout) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-8">
        <div className={cn("relative flex-1", short ? "min-h-[240px]" : "min-h-[320px]")}>
          <div
            className={cn(
              "felt leery-felt-texture absolute inset-x-[2%] bottom-1 top-[17%] flex flex-col overflow-y-auto rounded-[999px] px-10 pb-4 no-scrollbar",
              short ? "pt-14" : "pt-20",
            )}
          >
            <div className="m-auto flex flex-col items-center gap-4">{feltContent}</div>
          </div>
          {opponents.map((p, i) => renderSeat(p, arcStyles[i]))}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-2">{opponents.map((p) => renderSeat(p))}</div>
      </div>
      <div className="min-h-0 flex-1 px-3 py-2">
        <div className="felt leery-felt-texture relative flex h-full flex-col overflow-y-auto rounded-[2rem] px-3 py-3 no-scrollbar">
          <div className="m-auto flex flex-col items-center gap-3">{feltContent}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
