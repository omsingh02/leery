import { useState } from "react";
import { EyeOff, HelpCircle, Layers, ListOrdered, Megaphone, Sparkles, Swords, Trophy, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./useReturnFocus";

interface Step {
  icon: LucideIcon;
  /** Tailwind classes for the icon bubble (background + glyph colour). */
  tone: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: Layers,
    tone: "bg-primary/20 text-primary",
    title: "Get dealt in",
    body: "One deck is dealt out evenly. Nobody can see anyone else's cards.",
  },
  {
    icon: ListOrdered,
    tone: "bg-accent/20 text-accent",
    title: "Follow the rank",
    body: "Every turn has a required rank: Aces, then 2s, 3s… up to Kings, then back to Aces.",
  },
  {
    icon: EyeOff,
    tone: "bg-sky-400/20 text-sky-300",
    title: "Play face-down",
    body: "Put 1–4 cards in the pile and say they're all that rank. Tell the truth, or don't.",
  },
  {
    icon: Megaphone,
    tone: "bg-bluff/20 text-bluff",
    title: "Call it or accept",
    body: "Everyone else gets a few seconds to call bluff, or can tap Accept to keep things moving.",
  },
  {
    icon: Swords,
    tone: "bg-trust/20 text-trust",
    title: "Someone picks up the pile",
    body: "Caught lying? You take the whole pile. Called out wrongly? The caller takes it.",
  },
  {
    icon: Trophy,
    tone: "bg-gold/20 text-gold",
    title: "Empty your hand",
    body: "First one out wins. Even a last play can still be challenged, so make it convincing.",
  },
];

/** "How to play" — controlled. Worker A / the in-game menu open this from their own button. */
export function RulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="How to play"
        description="Be the first to empty your hand — by any means necessary."
        data-testid="rules-dialog"
        {...returnFocus}
      >
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3.5">
              <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", step.tone)}>
                <step.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  <span className="mr-1.5 font-display text-xs text-muted">{i + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-5 flex items-start gap-3 rounded-2xl border border-gold/25 bg-gold/[0.07] p-3.5 text-[13px] leading-snug text-foreground/90">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>
            <strong className="font-semibold text-gold">Count the cards.</strong> Only four of each rank exist — if you hold two
            7s and someone claims three, somebody is lying.
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Ghost "How to play" button that owns its dialog state. */
export function RulesButton({ className, label = "How to play", compact = false }: { className?: string; label?: string; /** Icon only on very narrow screens (the label stays available to screen readers). */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        data-testid="open-rules"
        aria-haspopup="dialog"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
        <span className={cn(compact && "max-[379px]:sr-only")}>{label}</span>
      </Button>
      <RulesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
