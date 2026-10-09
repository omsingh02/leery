import { AnimatePresence, motion } from "framer-motion";
import { Lightbulb } from "lucide-react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A first-time tip: a small bubble with an arrow that points at what it's about. Purely visual
 * (pointer-events none), announced politely, and gone as soon as the player does the thing.
 */
export function Hint({
  show,
  children,
  className,
  arrow = "down",
  testId,
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  /** Which side of the bubble the arrow is on. */
  arrow?: "down" | "up";
  testId?: string;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          data-testid={testId}
          initial={{ opacity: 0, y: arrow === "down" ? 8 : -8, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
          transition={spring.pop}
          className={cn(
            "pointer-events-none absolute z-30 flex max-w-[19rem] items-start gap-2 rounded-2xl bg-primary px-3.5 py-2.5 text-left text-xs font-semibold leading-snug text-primary-foreground shadow-glow-primary",
            className,
          )}
        >
          <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          <span>{children}</span>
          <span
            aria-hidden
            className={cn("absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-primary", arrow === "down" ? "-bottom-1.5" : "-top-1.5")}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
