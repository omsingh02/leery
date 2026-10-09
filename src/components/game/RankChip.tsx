import { cn } from "@/lib/utils";
import type { Rank } from "@/lib/types";

/** A little ivory card showing a rank — the "required rank" badge. Decorative (the rank is also spelled out in text). */
export function RankChip({ rank, size = "md", className }: { rank: Rank; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 -rotate-3 place-items-center rounded-lg bg-gradient-to-br from-white via-ivory to-[#e7dfca] font-display font-extrabold leading-none text-ink shadow-card",
        size === "sm" && "h-7 w-5 text-sm",
        size === "md" && "h-9 min-w-[1.65rem] px-1 text-base",
        size === "lg" && "h-11 min-w-[2.2rem] px-1.5 text-xl",
        className,
      )}
    >
      {rank}
    </span>
  );
}
