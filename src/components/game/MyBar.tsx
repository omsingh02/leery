import { memo, type Ref } from "react";
import { Crown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { RANK_PLURAL } from "@/lib/game";
import type { RoomView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { myNextTurn } from "./myNext";

/** A slim line above my hand: who I am, which rank I'll need next, and how many cards I hold. */
export const MyBar = memo(function MyBar({ view, avatarRef }: { view: RoomView; avatarRef?: Ref<HTMLDivElement> }) {
  const mine = view.players.find((p) => p.id === view.me.id);
  const myTurn = view.status === "turn" && view.turn?.player === view.me.id;
  const next = myNextTurn(view);
  const count = view.me.hand.length;
  return (
    <div className="mx-auto flex w-full max-w-xl shrink-0 items-center gap-2 px-4 pt-1">
      <div ref={avatarRef} className={cn("relative shrink-0 rounded-full transition-shadow", myTurn && "ring-2 ring-gold ring-offset-2 ring-offset-background animate-ring-pulse")}>
        <Avatar name={mine?.name ?? "You"} color={mine?.color ?? 0} bot={false} size={28} />
      </div>
      <span className={cn("max-w-[7rem] truncate text-sm font-semibold", myTurn ? "text-gold" : "text-foreground")}>{mine?.name ?? "You"}</span>
      {mine?.host && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" aria-label="Host" />}
      {next && next.turnsAway > 0 && (
        <span
          data-testid="my-next-rank"
          className="min-w-0 truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-muted"
          title="The rank you'll have to claim on your next turn — those cards are marked in your hand."
        >
          Next: <b className="text-foreground">{RANK_PLURAL[next.rank]}</b> · {next.turnsAway === 1 ? "you're up next" : `in ${next.turnsAway} turns`}
        </span>
      )}
      <span data-testid="my-card-count" className="ml-auto shrink-0 text-xs font-medium tabular-nums text-muted">
        {count} card{count === 1 ? "" : "s"}
      </span>
    </div>
  );
});
