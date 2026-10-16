import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sfx } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** Mute/unmute sound effects (persisted). Icon button, 40px. */
export function SoundToggle({ className }: { className?: string }) {
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, sfx.isMuted);
  return (
    <button
      type="button"
      data-testid="sound-toggle"
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      aria-pressed={!muted}
      onClick={() => {
        sfx.setMuted(!muted);
        // Turning sound on: the confirming blip has to wait until the audio is actually running (a context
        // built by this very tap is still suspended for a moment).
        if (muted) void sfx.unlock().then(() => sfx.play("select"));
      }}
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground",
        className,
      )}
    >
      {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
    </button>
  );
}
