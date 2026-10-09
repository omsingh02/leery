import { useState } from "react";
import { Lightbulb, Settings, Sparkles, Vibrate, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { feel } from "@/lib/feel";
import { useFx } from "@/lib/fx";
import { haptics } from "@/lib/haptics";
import { hints } from "@/lib/hints";
import { prefs, useEffectsReduced, usePrefs, type EffectsPref } from "@/lib/prefs";
import { sfx } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./useReturnFocus";

const EFFECTS: { value: EffectsPref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "reduced", label: "Reduced" },
];

function Row({ icon, title, body, children, id }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode; id: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-3">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="font-semibold leading-tight">
          {title}
        </p>
        <p id={`${id}-desc`} className="mt-0.5 text-xs leading-snug text-muted">
          {body}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Comfort settings: sound, vibration and how much the screen is allowed to move. Controlled. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const returnFocus = useReturnFocus();
  const p = usePrefs();
  const reduced = useEffectsReduced();
  const fx = useFx();
  const canVibrate = haptics.supported();
  const [tipsReset, setTipsReset] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Settings" description="Make Leery feel the way you like it." data-testid="settings-dialog" {...returnFocus}>
        <div className="space-y-2.5">
          <Row id="set-sound" icon={<Volume2 className="h-5 w-5" />} title="Sound effects" body="Card slaps, chimes and the occasional heartbeat.">
            <Switch
              data-testid="setting-sound"
              aria-labelledby="set-sound-label"
              aria-describedby="set-sound-desc"
              checked={p.sound}
              onCheckedChange={(on) => {
                prefs.set({ sound: on });
                if (on) {
                  sfx.unlock();
                  feel.emit({ type: "ui.toggle", on: true });
                }
              }}
            />
          </Row>

          <Row
            id="set-haptics"
            icon={<Vibrate className="h-5 w-5" />}
            title="Vibration"
            body={canVibrate ? "A little buzz when cards land, when it's your turn, and when a bluff is caught." : "This device doesn't support vibration."}
          >
            <Switch
              data-testid="setting-haptics"
              aria-labelledby="set-haptics-label"
              aria-describedby="set-haptics-desc"
              disabled={!canVibrate}
              checked={p.haptics && canVibrate}
              onCheckedChange={(on) => {
                prefs.set({ haptics: on });
                if (on) haptics.play("call");
              }}
            />
          </Row>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-3">
            <div className="flex items-center gap-3.5">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">Screen effects</p>
                <p className="mt-0.5 text-xs leading-snug text-muted">Shake, flashes and sparks. “Auto” follows your device's reduce-motion setting.</p>
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label="Screen effects"
              className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl bg-black/30 p-1"
              onKeyDown={(e) => {
                // Radio-group keyboard model: arrows move the choice (and focus) instead of tabbing through every option.
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const at = EFFECTS.findIndex((o) => o.value === p.effects);
                const next = EFFECTS[(at + step + EFFECTS.length) % EFFECTS.length];
                prefs.set({ effects: next.value });
                feel.emit({ type: "ui.tap" });
                e.currentTarget.querySelector<HTMLElement>(`[data-testid="setting-effects-${next.value}"]`)?.focus();
              }}
            >
              {EFFECTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={p.effects === o.value}
                  tabIndex={p.effects === o.value ? 0 : -1}
                  data-testid={`setting-effects-${o.value}`}
                  onClick={() => {
                    prefs.set({ effects: o.value });
                    feel.emit({ type: "ui.tap" });
                  }}
                  className={cn(
                    "rounded-lg px-2 py-2 text-sm font-semibold transition-all duration-200",
                    p.effects === o.value ? "bg-gradient-to-br from-primary to-accent text-white shadow-glow-primary" : "text-muted hover:bg-white/[0.06] hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2.5 w-full"
              disabled={reduced}
              onClick={() => {
                const at = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                fx.shake(0.55, 320);
                fx.ring(at, { color: "hsl(348 100% 62%)", size: 160, duration: 520, width: 3 });
                fx.burst("sparks", at, { count: 22, power: 0.8, spread: 360, color: ["hsl(348 100% 62%)", "#ec4899", "#f4efe4"] });
              }}
            >
              {reduced ? "Effects are reduced" : "Preview effects"}
            </Button>
          </div>

          <Row id="set-tips" icon={<Lightbulb className="h-5 w-5" />} title="First-time tips" body="Little hints that show once while you learn the game.">
            <Button
              variant="secondary"
              size="sm"
              data-testid="setting-reset-tips"
              onClick={() => {
                hints.reset();
                setTipsReset(true);
              }}
            >
              {tipsReset ? "Done" : "Show again"}
            </Button>
          </Row>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Gear button (40px) that opens the settings. */
export function SettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="open-settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        className={cn("grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground", className)}
      >
        <Settings className="h-5 w-5" aria-hidden />
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
