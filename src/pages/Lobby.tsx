import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Crown, Link2, LogOut, Play, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { Badge } from "@/components/shell/Badge";
import { Logo } from "@/components/shell/Logo";
import { RulesButton } from "@/components/shell/RulesDialog";
import { SettingsButton } from "@/components/shell/SettingsDialog";
import { SoundToggle } from "@/components/shell/SoundToggle";
import { useReturnFocus } from "@/components/shell/useReturnFocus";
import { WaitingDots } from "@/components/shell/WaitingDots";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import type { RoomController } from "@/hooks/useRoom";
import { BOT_STYLES, SPEEDS } from "@/lib/game";
import { feel } from "@/lib/feel";
import { MAX_PLAYERS, MIN_PLAYERS, type PlayerView, type RoomView, type Speed } from "@/lib/types";
import { cn } from "@/lib/utils";
import { copyText, inviteLink, useDocumentTitle } from "./helpers";

const spring = { type: "spring" as const, stiffness: 380, damping: 28 };

export function Lobby({ room, view }: { room: RoomController; view: RoomView }) {
  const navigate = useNavigate();
  const { players, me, code, settings } = view;
  const isHost = me.host;
  const host = players.find((p) => p.host);
  const full = players.length >= MAX_PLAYERS;
  const openSeats = MAX_PLAYERS - players.length;
  const canStart = players.length >= MIN_PLAYERS;
  const otherHumans = players.filter((p) => !p.bot && p.id !== me.id).length;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const returnFocus = useReturnFocus();

  useDocumentTitle(`Lobby · ${code}`);

  // A little "pop" whenever someone new sits down.
  const prevCount = useRef(players.length);
  useEffect(() => {
    if (players.length > prevCount.current) feel.emit({ type: "lobby.join" });
    else if (players.length < prevCount.current) feel.emit({ type: "lobby.leave" });
    prevCount.current = players.length;
  }, [players.length]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  function flash(what: "code" | "link") {
    setCopied(what);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1800);
  }

  async function copyCode() {
    if (await copyText(code)) {
      flash("code");
      feel.emit({ type: "ui.copy" });
      toast.success("Room code copied");
    } else {
      notifyError("Couldn't copy — press and hold the code instead");
    }
  }

  async function copyLink() {
    if (await copyText(inviteLink(code))) {
      flash("link");
      feel.emit({ type: "ui.copy" });
      toast.success("Invite link copied");
    } else {
      notifyError("Couldn't copy the link");
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Leery",
        text: `Join my game of Leery — room ${code}`,
        url: inviteLink(code),
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) notifyError("Couldn't open the share sheet");
    }
  }

  async function startGame() {
    if (starting) return;
    setStarting(true);
    const ok = await room.start();
    if (!ok) setStarting(false); // on success the lobby is replaced by the table
  }

  async function leave() {
    setLeaving(true);
    const ok = await room.leave();
    if (ok) navigate("/");
    else setLeaving(false);
  }

  const leaveNote = !otherHumans
    ? "You're the only human here, so the room will close."
    : isHost
      ? "Hosting will pass to another player."
      : `You can hop back in with the code ${code} while the lobby is open.`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 safe-pt safe-pb max-lg:pb-40 sm:px-8" data-testid="lobby">
      <header className="flex items-center justify-between py-3">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          <RulesButton />
          <SoundToggle />
          <SettingsButton />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-4 pb-6 pt-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6 lg:pt-8">
        {/* ------------------------------------------------ room code + invite */}
        <section
          aria-labelledby="code-heading"
          className="glass rounded-3xl p-5 text-center sm:p-6 lg:col-start-1 lg:row-start-1"
        >
          <h2 id="code-heading" className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
            Room code
          </h2>
          <button
            type="button"
            data-testid="room-code"
            onClick={() => void copyCode()}
            aria-label={`Room code ${code.split("").join(" ")}. Tap to copy.`}
            className="mx-auto mt-3 flex gap-1.5 rounded-2xl outline-offset-4 sm:gap-2"
          >
            {code.split("").map((ch, i) => (
              <motion.span
                key={`${i}-${ch}`}
                initial={{ y: 16, opacity: 0, rotateX: -60 }}
                animate={{ y: 0, opacity: 1, rotateX: 0 }}
                transition={{ ...spring, delay: 0.05 + i * 0.05 }}
                className={cn(
                  "glass grid h-16 w-[clamp(2.25rem,12vw,2.75rem)] place-items-center rounded-2xl font-display text-3xl font-black transition-[box-shadow,border-color] duration-300 sm:h-[4.5rem] sm:w-12 sm:text-4xl",
                  copied === "code" && "border-trust/70 shadow-glow-trust",
                )}
              >
                <span className="brand-gradient-text">{ch}</span>
              </motion.span>
            ))}
          </button>
          <p className="mt-2.5 text-xs text-muted">Tap the code to copy it</p>

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="min-w-0 flex-1" data-testid="copy-invite" onClick={() => void copyLink()}>
              {copied === "link" ? (
                <Check className="h-4 w-4 text-trust" aria-hidden />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden />
              )}
              {copied === "link" ? "Copied!" : "Copy invite link"}
            </Button>
            {canShare && (
              <Button variant="secondary" data-testid="share-invite" onClick={() => void share()}>
                <Share2 className="h-4 w-4" aria-hidden />
                Share
              </Button>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------ players */}
        <section aria-labelledby="players-heading" className="glass rounded-3xl p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 id="players-heading" className="font-display text-base font-bold">
              Players
            </h2>
            <span className="text-sm tabular-nums text-muted" data-testid="player-count">
              {players.length}/{MAX_PLAYERS}
            </span>
          </div>
          <ul className="space-y-2" aria-label="Players in this room">
            <AnimatePresence initial={false}>
              {players.map((p) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  isMe={p.id === me.id}
                  canRemove={isHost && p.id !== me.id}
                  busy={room.busy}
                  onRemove={() => void room.removePlayer(p.id)}
                />
              ))}
            </AnimatePresence>
            {Array.from({ length: openSeats }, (_, i) => (
              <li
                key={`empty-${i}`}
                aria-hidden
                className={cn(
                  "flex h-[58px] animate-pulse items-center gap-3 rounded-2xl border border-dashed border-white/10 px-3 text-sm text-muted/70",
                  i >= 2 && "max-lg:hidden",
                )}
                style={{ animationDelay: `${i * 160}ms`, animationDuration: "2.6s" }}
              >
                <span className="grid h-[42px] w-[42px] place-items-center rounded-full border border-dashed border-white/15" />
                Waiting for player…
              </li>
            ))}
            {openSeats > 2 && (
              <li aria-hidden className="py-1 text-center text-xs text-muted lg:hidden">
                +{openSeats - 2} more seats open
              </li>
            )}
          </ul>
        </section>

        {/* ---------------------------------------------------- speed + actions */}
        {/* No backdrop-filter here: a fixed child (the mobile action bar) must anchor to the viewport. */}
        <section className="space-y-4 rounded-3xl border border-white/[0.08] bg-surface/70 p-4 sm:p-5 lg:col-start-1 lg:row-start-2">
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="font-display text-base font-bold">Game speed</h2>
              {!isHost && <span className="text-xs text-muted">Set by the host</span>}
            </div>
            <SpeedPicker
              value={settings.speed}
              editable={isHost && !room.busy}
              onChange={(s) => void room.setSpeed(s)}
            />
          </div>

          {/* Pinned to the bottom of the screen on phones so "Start" is always reachable; inline on desktop. */}
          <div
            className={cn(
              "lg:space-y-2.5",
              "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-white/10",
              "max-lg:bg-background/[0.96] max-lg:px-4 max-lg:pt-3 max-lg:shadow-[0_-14px_32px_-10px_rgb(0_0_0/0.75)] max-lg:backdrop-blur-xl max-lg:pb-[max(env(safe-area-inset-bottom),0.75rem)]",
            )}
          >
            {isHost ? (
              <>
                <div className="mx-auto flex max-w-md gap-2 lg:max-w-none lg:flex-col lg:gap-2.5">
                  <Button
                    variant="secondary"
                    size="lg"
                    className="max-lg:shrink-0 max-lg:px-4 lg:w-full"
                    data-testid="add-bot"
                    disabled={full || room.busy}
                    onClick={() => void room.addBot()}
                  >
                    <Bot className="h-5 w-5" aria-hidden />
                    {full ? "Full" : "Add bot"}
                  </Button>
                  <Button
                    size="xl"
                    className="max-lg:min-w-0 max-lg:flex-1 lg:w-full"
                    data-testid="start-game"
                    disabled={!canStart || room.busy}
                    loading={starting}
                    onClick={() => void startGame()}
                  >
                    <Play className="h-5 w-5" aria-hidden />
                    Start game
                  </Button>
                </div>
                <p className="text-center text-xs text-muted max-lg:mt-2" data-testid="start-hint" role="status">
                  {canStart
                    ? `${players.length} players · ${SPEEDS[settings.speed].label} pace`
                    : "Add a friend or a bot to start"}
                </p>
              </>
            ) : (
              <div
                data-testid="waiting-host"
                role="status"
                className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-center text-sm lg:max-w-none"
              >
                Waiting for <strong className="font-semibold text-gold">{host?.name ?? "the host"}</strong> to start{" "}
                <WaitingDots className="ml-0.5 inline-flex items-center gap-1 align-middle text-muted" />
              </div>
            )}
          </div>

          <Button variant="ghost" className="w-full" data-testid="leave-room" onClick={() => setLeaveOpen(true)}>
            <LogOut className="h-4 w-4" aria-hidden />
            Leave room
          </Button>
        </section>
      </div>

      <Dialog open={leaveOpen} onOpenChange={(o) => !leaving && setLeaveOpen(o)}>
        <DialogContent title="Leave this room?" description={leaveNote} data-testid="leave-dialog" {...returnFocus}>
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary" size="lg" disabled={leaving}>
                Stay
              </Button>
            </DialogClose>
            <Button variant="bluff" size="lg" loading={leaving} data-testid="leave-confirm" onClick={() => void leave()}>
              <LogOut className="h-4 w-4" aria-hidden />
              Leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/* ------------------------------------------------------------------------------------------- */

function PlayerRow({
  player: p,
  isMe,
  canRemove,
  busy,
  onRemove,
}: {
  player: PlayerView;
  isMe: boolean;
  canRemove: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, x: -24 }}
      transition={spring}
      data-testid={`player-row-${p.id}`}
      className={cn(
        "flex h-[58px] items-center gap-3 rounded-2xl border bg-white/[0.04] px-3",
        isMe ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : "border-white/[0.07]",
      )}
    >
      <Avatar name={p.name} color={p.color} bot={p.bot} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold leading-tight">{p.name}</span>
          {p.host && (
            <Badge tone="gold">
              <Crown className="h-3 w-3" aria-hidden />
              Host
            </Badge>
          )}
          {isMe && <Badge tone="primary">You</Badge>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {p.bot ? (
            <>
              <Bot className="h-3 w-3" aria-hidden />
              Bot · {BOT_STYLES[p.style ?? "balanced"].label}
            </>
          ) : (
            <>
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", p.online ? "bg-trust shadow-[0_0_8px_hsl(var(--trust))]" : "bg-muted/50")}
              />
              {p.online ? "Online" : "Away"}
            </>
          )}
        </p>
      </div>
      {canRemove && (
        <button
          type="button"
          data-testid={`remove-player-${p.id}`}
          aria-label={p.bot ? `Remove ${p.name}` : `Kick ${p.name}`}
          disabled={busy}
          onClick={onRemove}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-bluff/15 hover:text-bluff disabled:opacity-40"
        >
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      )}
    </motion.li>
  );
}

function SpeedPicker({
  value,
  editable,
  onChange,
}: {
  value: Speed;
  editable: boolean;
  onChange: (speed: Speed) => void;
}) {
  const speeds = Object.keys(SPEEDS) as Speed[];
  const index = speeds.indexOf(value);
  return (
    <fieldset disabled={!editable} className="min-w-0">
      <legend className="sr-only">Game speed</legend>
      <div className="relative grid grid-cols-3 gap-1.5 rounded-2xl bg-black/30 p-1.5">
        {/* The marker glides to the chosen speed (plain CSS transform: no layout measuring to go wrong). */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-xl bg-gradient-to-br from-primary to-accent shadow-glow-primary"
          style={{
            width: "calc((100% - 0.75rem - 0.75rem) / 3)",
            transform: `translateX(calc(${index} * (100% + 0.375rem)))`,
            transition: "transform 320ms cubic-bezier(0.34, 1.35, 0.5, 1)",
          }}
        />
        {speeds.map((s) => {
          const checked = value === s;
          const [turn, call] = SPEEDS[s].blurb.split(" · ");
          return (
            <label
              key={s}
              data-testid={`speed-${s}`}
              className={cn(
                "relative rounded-xl px-1.5 py-2.5 text-center transition-colors duration-200",
                editable ? "cursor-pointer" : "cursor-default",
                checked ? "text-white" : cn("text-muted", editable && "hover:text-foreground"),
              )}
            >
              <input
                type="radio"
                name="speed"
                value={s}
                checked={checked}
                onChange={() => {
                  feel.emit({ type: "ui.toggle", on: true });
                  onChange(s);
                }}
                className="peer sr-only"
              />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-ring opacity-0 peer-focus-visible:opacity-100" />
              <span className="relative block font-display text-[13px] font-bold">{SPEEDS[s].label}</span>
              <span className="relative mt-1 block text-[10.5px] leading-tight opacity-85">{turn}</span>
              <span className="relative block text-[10.5px] leading-tight opacity-85">{call}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
