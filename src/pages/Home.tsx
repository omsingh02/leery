import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Bot, Minus, Plus, RotateCcw, Users, X, Zap } from "lucide-react";
import { notifyError } from "@/lib/notify";
import { CardFan } from "@/components/shell/DecorCards";
import { LogoMark } from "@/components/shell/Logo";
import { RulesButton } from "@/components/shell/RulesDialog";
import { SettingsButton } from "@/components/shell/SettingsDialog";
import { SoundToggle } from "@/components/shell/SoundToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useShakeTarget } from "@/lib/fx";
import { clearLastRoom, getLastRoom, getName, getToken, setName } from "@/lib/session";
import { sfx } from "@/lib/sound";
import { CODE_LENGTH, MAX_NAME, MAX_PLAYERS } from "@/lib/types";
import { cleanName, isValidName, NAME_HINT, parseRoomCode } from "./helpers";

const MIN_BOTS = 1;
const MAX_BOTS = MAX_PLAYERS - 1;

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 380, damping: 28, delay: 0.05 + i * 0.06 },
  }),
};

export function Home() {
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useShakeTarget(mainRef); // so the effects preview in Settings can shake something

  const [name, setNameValue] = useState(() => getName());
  const [nameError, setNameError] = useState<string | null>(null);
  const [bots, setBots] = useState(3);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "create" | "solo">(null);
  const [lastRoom, setLastRoomState] = useState(() => getLastRoom());

  /** Returns the cleaned name, or null (and focuses the field) when it's invalid. */
  function requireName(): string | null {
    const clean = cleanName(name);
    if (!isValidName(clean)) {
      setNameError(NAME_HINT);
      nameRef.current?.focus();
      return null;
    }
    setNameError(null);
    return clean;
  }

  async function start(kind: "create" | "solo") {
    if (busy) return;
    const clean = requireName();
    if (!clean) return;
    void sfx.unlock();
    setBusy(kind);
    try {
      setName(clean);
      const view = await api.createRoom(getToken(), clean, kind === "solo" ? { bots, start: true } : {});
      navigate(`/r/${view.code}`);
    } catch (e) {
      notifyError((e instanceof ApiError ? e : new ApiError("unknown")).message);
    } finally {
      setBusy(null);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    const clean = cleanName(name);
    if (isValidName(clean)) setName(clean); // the join screen prefills from this
    navigate(`/r/${code}`);
  }

  return (
    <main ref={mainRef} className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 safe-pt safe-pb sm:px-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-7 py-4 sm:gap-10 lg:flex-row lg:justify-between lg:gap-20">
        {/* ------------------------------------------------------------ hero */}
        <motion.section
          initial="hidden"
          animate="show"
          className="flex w-full max-w-xl flex-col items-center text-center lg:items-start lg:text-left"
        >
          <motion.div variants={rise} custom={0} className="mb-3 sm:mb-6 lg:mb-10">
            <CardFan />
          </motion.div>

          <motion.h1
            variants={rise}
            custom={1}
            className="flex items-center gap-[0.22em] font-display text-[clamp(2.05rem,9.6vw,3.1rem)] font-extrabold leading-[0.95] tracking-[0.015em] drop-shadow-[0_0_28px_hsl(var(--primary)/0.4)] sm:text-6xl lg:text-[5.4rem]"
          >
            <LogoMark size="0.86em" />
            <span className="brand-gradient-text">Leery</span>
          </motion.h1>

          <motion.p variants={rise} custom={2} className="mt-3 font-display text-[15px] font-semibold sm:mt-4 sm:text-lg">
            <span className="text-foreground">Lie.</span> <span className="text-bluff">Call it.</span>{" "}
            <span className="text-gold">Clear your hand.</span>
          </motion.p>

          <motion.ul
            variants={rise}
            custom={3}
            aria-label="Highlights"
            className="mt-4 flex flex-wrap justify-center gap-1.5 text-[11px] font-medium text-muted sm:gap-2 sm:text-xs lg:justify-start"
          >
            <li className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
              <Users className="h-3 w-3 text-primary sm:h-3.5 sm:w-3.5" aria-hidden />
              2–{MAX_PLAYERS} players
            </li>
            <li className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
              <Bot className="h-3 w-3 text-accent sm:h-3.5 sm:w-3.5" aria-hidden />
              Bots welcome
            </li>
            <li className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5">
              <Zap className="h-3 w-3 text-gold sm:h-3.5 sm:w-3.5" aria-hidden />
              No sign-up
            </li>
          </motion.ul>
        </motion.section>

        {/* ----------------------------------------------------------- panel */}
        <motion.section
          aria-label="Start playing"
          initial="hidden"
          animate="show"
          variants={rise}
          custom={2}
          className="relative w-full max-w-md"
        >
          <div
            aria-hidden
            className="absolute -inset-3 -z-10 rounded-[2.4rem] bg-gradient-to-br from-primary/30 via-transparent to-accent/30 blur-2xl"
          />
          <div className="glass-strong relative overflow-hidden rounded-3xl p-5 sm:p-6">
            <div
              aria-hidden
              className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
            />

            {lastRoom && (
              <div
                data-testid="rejoin-card"
                className="mb-5 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/[0.08] py-2.5 pl-3.5 pr-2"
              >
                <RotateCcw className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-xs text-muted">Pick up where you left off</p>
                  <p className="font-display text-base font-bold tracking-[0.25em] text-gold">{lastRoom.code}</p>
                </div>
                <Button
                  size="sm"
                  variant="gold"
                  data-testid="rejoin-room"
                  onClick={() => navigate(`/r/${lastRoom.code}`)}
                >
                  Rejoin
                </Button>
                <button
                  type="button"
                  aria-label="Dismiss rejoin"
                  onClick={() => {
                    clearLastRoom();
                    setLastRoomState(null);
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}

            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void start("create");
              }}
            >
              <label htmlFor="player-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Your name
              </label>
              <Input
                id="player-name"
                ref={nameRef}
                data-testid="name-input"
                value={name}
                maxLength={MAX_NAME}
                placeholder="What should we call you?"
                autoComplete="nickname"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "player-name-error" : undefined}
                onChange={(e) => {
                  setNameValue(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
              {nameError && (
                <p id="player-name-error" role="alert" className="mt-1.5 text-sm text-bluff">
                  {nameError}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-4 w-full"
                loading={busy === "create"}
                disabled={busy === "solo"}
                data-testid="create-room"
              >
                <Plus className="h-5 w-5" aria-hidden />
                Create room
              </Button>
            </form>

            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                size="lg"
                className="min-w-0 flex-1"
                loading={busy === "solo"}
                disabled={busy === "create"}
                onClick={() => void start("solo")}
                data-testid="solo-start"
              >
                <Bot className="h-5 w-5" aria-hidden />
                Play vs bots
              </Button>
              <div role="group" aria-label="Number of bots" className="glass flex h-12 shrink-0 items-center rounded-full px-1">
                <button
                  type="button"
                  aria-label="Fewer bots"
                  data-testid="solo-bots-dec"
                  disabled={bots <= MIN_BOTS}
                  onClick={() => setBots((n) => Math.max(MIN_BOTS, n - 1))}
                  className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <span
                  data-testid="solo-bots-count"
                  aria-live="polite"
                  aria-label={`${bots} ${bots === 1 ? "bot" : "bots"}`}
                  className="w-6 text-center font-display text-base font-bold"
                >
                  {bots}
                </span>
                <button
                  type="button"
                  aria-label="More bots"
                  data-testid="solo-bots-inc"
                  disabled={bots >= MAX_BOTS}
                  onClick={() => setBots((n) => Math.min(MAX_BOTS, n + 1))}
                  className="grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-center text-xs text-muted">
              {bots} {bots === 1 ? "bot" : "bots"} · starts instantly
            </p>

            <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80" aria-hidden>
              <span className="h-px flex-1 bg-white/10" />
              or join friends
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <form onSubmit={join} noValidate>
              <label htmlFor="join-code" className="sr-only">
                Room code
              </label>
              <div className="flex gap-2">
                <Input
                  id="join-code"
                  data-testid="join-code-input"
                  value={code}
                  placeholder="CODE"
                  maxLength={64}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  onChange={(e) => setCode(parseRoomCode(e.target.value))}
                  className="min-w-0 flex-1 px-2 text-center font-display text-lg font-bold uppercase tracking-[0.4em] placeholder:tracking-[0.3em]"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={code.length !== CODE_LENGTH}
                  data-testid="join-room"
                >
                  Join
                  <ArrowRight className="h-5 w-5" aria-hidden />
                </Button>
              </div>
            </form>
          </div>
        </motion.section>
      </div>

      <footer className="flex items-center justify-between gap-3 py-3 text-xs text-muted">
        <div className="flex items-center gap-1">
          <RulesButton />
          <SoundToggle />
          <SettingsButton />
        </div>
        <p className="text-right leading-relaxed">
          © 2026{" "}
          <a href="https://github.com/omsingh02" className="underline-offset-2 hover:text-foreground hover:underline" target="_blank" rel="noreferrer">
            Om Singh
          </a>{" "}
          ·{" "}
          <a href="https://github.com/omsingh02/leery" className="underline-offset-2 hover:text-foreground hover:underline" target="_blank" rel="noreferrer">
            Source
          </a>
        </p>
      </footer>
    </main>
  );
}
