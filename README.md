<p align="center">
  <img src="docs/banner.png" alt="Leery — the bluffing card game. Lie. Call it. Clear your hand." width="100%">
</p>

<p align="center">
  A realtime bluffing card game for 2–8 players.<br>
  Play with friends or bots — no sign-up, and a server that can't be cheated.
</p>

<p align="center">
  <a href="https://leery.omsingh.me"><strong>▶ Play now</strong></a> &nbsp;·&nbsp;
  <a href="#how-to-play">How to play</a> &nbsp;·&nbsp;
  <a href="#run-it-yourself">Run it yourself</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a>
</p>

<p align="center">
  <a href="https://github.com/omsingh02/leery/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/omsingh02/leery/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8b5cf6"></a>
  <a href="https://leery.omsingh.me"><img alt="Play online" src="https://img.shields.io/badge/play-leery.omsingh.me-ec4899"></a>
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  <img alt="Rules run in Postgres" src="https://img.shields.io/badge/rules-run%20in%20Postgres-336791">
</p>

<p align="center">
  <img src="docs/screenshots/hero.webp" alt="Leery on three phones: the lobby, a challenge with the Call bluff button, and a bluff being caught" width="880">
</p>

## What is Leery?

*leery* (adj.) — suspicious, wary of what you're being told. Which is exactly how you should feel about everyone at the table.

Everyone knows the game: play cards face-down, say what they are, and let everyone else decide whether to believe you.
Leery is that game built properly. Open a table from a six-letter code, fill empty seats with bots that have
personalities, and trust nothing about the other players — **including the software**. The rules run inside the
database, so nobody can peek at your hand, play out of turn, or fake a result.

## Features

- **2–8 players in seconds.** Share a 6-letter code or an invite link. No accounts, no installs, runs in any browser.
- **Bots with personalities.** Cautious, balanced, reckless and paranoid bots bluff and call differently. Play solo
  against 1–7 of them with a single tap.
- **Three speeds.** Relaxed, Standard or Blitz set the turn timer and the window for calling a bluff.
- **Never stalls.** Timers and bots run on the server: an AFK player is auto-played and then put on autopilot, a player
  who leaves is replaced by a bot, and a silent host hands the role on.
- **Cheat-proof by design.** Hands never leave the database, every action is validated server-side, and the only API is
  a short list of functions rather than open tables. See [Security](#security).
- **Built for phones.** Thumb-friendly controls, drag picked cards up onto the table to play them, and a
  keyboard-accessible hand on desktop.
- **A table with weight.** Cards slap down, a caught bluff shakes the screen, and the last card of a reveal waits for a
  drumroll. Sound is synthesised live (no audio files), phones buzz in the right places, and all of it can be switched
  off or toned down. See [Game feel](#game-feel).
- **Instant, but resilient.** Realtime pings when available, automatic fallback to polling when not.

## Screenshots

<p align="center">
  <img src="docs/screenshots/home.webp" alt="Home: pick a name, create a room, play against bots or join with a code" width="200" title="Home">
  <img src="docs/screenshots/lobby.webp" alt="Lobby: room code, invite link, players, bots and speed" width="200" title="Lobby">
  <img src="docs/screenshots/table.webp" alt="Your turn: select 1 to 4 cards and play them face-down" width="200" title="Your turn">
  <img src="docs/screenshots/challenge.webp" alt="Challenge window: call bluff or accept" width="200" title="Challenge">
  <img src="docs/screenshots/reveal-bluff.webp" alt="A bluff is caught and the liar picks up the pile" width="200" title="Bluff caught">
  <img src="docs/screenshots/reveal-honest.webp" alt="An honest play: the caller picks up the pile" width="200" title="Honest play">
  <img src="docs/screenshots/game-over.webp" alt="Game over: final standings and a rematch button" width="200" title="Game over">
</p>

<p align="center">
  <sub>Home · Lobby · Your turn · Challenge · Bluff caught · Honest play · Game over</sub>
</p>

On a big screen the table opens up, with up to seven opponents around the felt:

<p align="center">
  <img src="docs/screenshots/desktop-lobby.webp" alt="Leery lobby on desktop" width="435" title="Desktop lobby">
  <img src="docs/screenshots/desktop-table.webp" alt="Leery table on desktop: an oval felt table, your hand along the bottom" width="435" title="Desktop table">
</p>

## Game feel

<p align="center">
  <img src="docs/screenshots/bluff-called.webp" alt="A bluff being called: the claim, the cards turning over one by one, the BLUFF! stamp and the pickup" width="300">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/settings.webp" alt="Settings: sound effects, vibration and screen effects" width="300">
</p>

Leery is built to feel like a game, not a form.

- **Instant response.** Cards and buttons press in the moment a finger lands, and a card you play leaves your hand before
  the server has replied. Tap Play, or flick the picked cards up onto the table.
- **A bluff is an event.** The call lands with a shake and a flash, the played cards rise out of the pile and turn over one
  by one — the last after a drumroll — then the verdict slams down and the pile sweeps to whoever has to take it.
- **Tension you can hear.** A turn timer running down speeds up a heartbeat and closes a red vignette in from the edges;
  a player's last card gets its own warning.
- **Sound without files.** Every sound is synthesised in the browser and panned to where it happens on the table. There
  is nothing to download.
- **Yours to turn down.** Settings has switches for sound, vibration and screen effects; *Reduced* removes shake, flashes
  and particles, and *Auto* follows the device's reduce-motion setting. First-time tips show once, and can be shown again.

How it's put together, the timeline of a reveal, how to add a sound or an effect, and the labs for auditioning them
(`/dev/audio.html`, `/dev/fx.html`) are in [docs/game-feel.md](docs/game-feel.md).

## How to play

1. One 52-card deck is dealt around the table.
2. The **required rank advances every turn**: A, 2, 3 … K, A …
3. On your turn, play **1–4 cards face-down** and claim they are all the required rank. You may lie.
4. A short **challenge window** opens. Everyone else can **call bluff** or **accept**.
5. If someone calls, the cards are revealed. If *any* card isn't the claimed rank, the **liar picks up the whole pile**;
   otherwise the **caller** does.
6. The first player to **empty their hand wins** — and a last play can still be challenged.

Bluff rarely, bluff big, and watch who hesitates.

## How it works

```mermaid
flowchart LR
  A["Your browser<br/>React + TypeScript"] -->|"RPC (supabase-js)"| P["PostgREST<br/>13 public.leery_* functions"]
  P --> D[("Postgres · private game schema<br/>rules · bots · timers")]
  A -.->|"realtime ping (optional)"| O["Other players"]
```

- **The database is the referee.** Tables live in a private `game` schema that is never exposed through the Data API (RLS
  on, no policies). The only way in is 13 `SECURITY DEFINER` functions (`leery_play`, `leery_call`, …) that check the
  caller's token, the phase and whose turn it is, and only ever return the caller's *own* cards.
- **Identity without accounts.** Each device keeps a random 192-bit token in `localStorage`; the server stores only its
  SHA-256 hash. Clear your site data and you lose your seat — that's the trade for zero sign-up.
- **No worker process.** Bots, turn timers and challenge windows advance **lazily**: every state poll first applies any
  due transition under the room's row lock (`game.advance`). The game keeps moving as long as one human has the page
  open, and nothing stalls if the player whose turn it is closes their tab. Clients poll right at the server-reported
  deadline, so transitions feel instant.
- **Realtime is an accelerator, not a dependency.** After a change, clients broadcast a tiny "ping" so others refetch
  immediately. If Realtime is blocked or disabled the app falls back to fast polling and nothing else changes.
- **Concurrency.** Every mutating call locks the room row first (`FOR UPDATE`), then touches player rows: one writer per
  room and a fixed lock order, so no deadlocks (covered by a concurrency test).
- **Bots are heuristics, not cheaters.** They play honestly when they can, bluff with the cards least useful to them, and
  call bluff using what they can *prove* (only four of any rank exist), how many cards the player has left and their
  personality. They never see anyone else's hand.

## Security

The engine was reviewed for information leaks, privilege escalation, wedged states and abuse, and every confirmed finding
has a regression test in [`tests/db/hardening.test.ts`](tests/db/hardening.test.ts).

- **Nobody can see or fake anything.** Other players' hands and the face-down pile never leave the database. Card arrays
  are shape-checked at the API *and* constrained in storage (Postgres arrays can otherwise carry custom lower bounds or
  extra dimensions).
- **No internals leak.** Expected errors are stable codes (`not_your_turn`, `bad_cards`, …); anything unexpected becomes a
  bare `server_error` while the details stay in the server log. Every function pins `search_path = pg_catalog, pg_temp`.
- **Abuse limits.** Room creation is limited per device (20/hour) and per client address (120/hour, via the proxy's
  `cf-connecting-ip`), counting creations rather than live rooms; the address is kept next to the creation event for two
  hours and then purged, and nothing else about a visitor is recorded. A global room cap (default 5000, change it with
  `alter database … set leery.room_cap = '20000'`) retires the longest-idle lobbies instead of locking everyone out.
  Names, codes, ban lists and card arrays are bounded and normalised (invisible and bidi characters stripped, full-width
  and no-break look-alikes folded).
- **Self-healing rooms.** A host who vanishes hands the role on after 60 s of silence, a player who leaves on their turn is
  replaced instantly, and leaving always works — even in a wedged room.
- **Unguessable codes.** Room codes are 6 characters (~887 million combinations).

Known limits, worth knowing before a large public launch:

- Anyone holding the (public) API key can create rooms. The limits above blunt that, but a determined botnet needs an
  edge rate-limiter such as Cloudflare in front.
- Look-alike names using *different alphabets* (Cyrillic "Н" for Latin "H") are not detected.
- The Realtime channel `leery:<code>` is a public broadcast: anyone who knows a code can send pings. Clients throttle
  them (≤ 2 refreshes/s), so the worst case is wasted polling, never wrong data.
- Device tokens travel in request bodies, so keep request/statement logging off for the API.

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).

## Run it yourself

You need Node 20+.

```bash
git clone https://github.com/omsingh02/leery.git && cd leery
npm ci
cp .env.example .env.local        # then fill in the two VITE_SUPABASE_* values
npm run dev                       # http://localhost:8080
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The project's publishable (anon) key — public by design |
| `VITE_REALTIME` | no | Set to `off` to disable Realtime pings and use polling only |

### Backend option A — the real Supabase stack (needs Docker)

```bash
supabase start                    # prints the local API URL and publishable/anon key
supabase db reset                 # applies supabase/migrations/*
# put the printed URL + key into .env.local
```

### Backend option B — any Postgres, no Supabase stack

`scripts/dev-api.mjs` serves the app's RPC calls straight from Postgres (as the `anon` role, like PostgREST). Realtime isn't
included, so the app polls.

```bash
docker run -d --name leery-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:54399:5432 postgres:16-alpine
DEV_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54399/postgres npm run dev:api     # serves :54321
# .env.local → VITE_SUPABASE_URL=http://127.0.0.1:54321  VITE_SUPABASE_PUBLISHABLE_KEY=dev  VITE_REALTIME=off
```

Handy for solo testing: open the app with `?as=alice` and `?as=bob` in two tabs to get two independent players in one
browser.

### UI playground — no backend at all

Every screen can be previewed from hand-written snapshots (`src/dev/fixtures.ts`), which is how the interface was built and
screenshot-tested:

```bash
npm run dev:ui                    # → /dev/game.html?state=turn-mine
# other states:  turn-theirs · turn-bot · challenge-call · challenge-accused · reveal-bluff · reveal-honest · eight-players …
# lobby / join / game-over / error screens:  /dev/shell.html?state=lobby-host | finished-win | error-room_not_found | …   (?page=home)
# a scripted game, to watch the choreography:  /dev/game.html?sim=1
# labs for tuning the feel:  /dev/audio.html (every sound and vibration) · /dev/fx.html (every visual effect)
```

## Deploy

**1. Database** — one migration creates the private `game` schema and the public API. Use a fresh Supabase project (it adds
only the `game` schema and the 13 `public.leery_*` functions, and creates no tables in `public`):

```bash
supabase login
supabase link --project-ref <your-project-ref>      # asks for the database password
supabase db push
```

Supabase's advisor will flag the `SECURITY DEFINER` functions. That is intentional — see the header of the engine
migration for why.

**2. Frontend (Vercel)** — set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the Vercel project (Production
**and** Preview) and deploy; with a Git-connected project, a push to `main` does it. [`vercel.json`](vercel.json) provides
the SPA fallback (deep links like `/r/ABCDEF`), immutable asset caching and security headers including a CSP. The CSP's
`connect-src` allows `https://*.supabase.co` and `wss://*.supabase.co` — **if you use a custom Supabase domain, add it
there.**

**3. Optional housekeeping** — abandoned rooms are also cleaned up whenever a room is created. To sweep on a schedule with
`pg_cron`:

```sql
select cron.schedule('leery-cleanup', '*/30 * * * *',
  $$ delete from game.rooms r where r.last_active < now() - interval '6 hours'
       and not exists (select 1 from game.players p where p.room_id = r.id and p.last_seen > now() - interval '6 hours') $$);
```

The Supabase project doesn't need Auth, anonymous sign-ins or any dashboard toggles; Realtime Broadcast is used only as an
accelerator.

## Tuning

Game feel lives in a few SQL functions (change them with a new migration): `game.speed_*_seconds` (turn and challenge
timers), `game.style` (bot personalities: `lie`, `greed`, `sus`), `game.plan_bot_call` (when bots call bluff) and
`game.choose_play` (what they play). The simulation in `npm run test:db` prints average game length and call rates, so
changes are easy to evaluate.

## Tests

| Command | What it covers |
| --- | --- |
| `npm run typecheck` · `npm run lint` | TypeScript (app, UI playground, tests) and ESLint |
| `npm test` | Unit tests for the client sync layer (polling at server deadlines, backoff, clock skew, stale responses, double-submit protection, error recovery), the pure helpers, and the game-feel layer (event plan, director, reveal timeline, synth, haptics, effects) |
| `npm run test:db` | The engine against a throwaway Postgres in Docker: lobby rules, privacy (no card ever leaks, `anon` can't touch tables), every phase transition, timers and AFK, leaving, rematch, concurrency races, abuse limits, and full bot-played games with card-conservation checks |
| `npm run e2e` | Playwright drives the real UI against the real engine on a phone viewport: solo game vs bots, invite link → two humans + a bot, reload restores your seat, finish + rematch, kicking, drag-to-play, settings, error screens. Needs a Postgres (see `playwright.config.ts`); `E2E_VISUAL=1` runs the screenshot tour instead |
| `node scripts/audio-check.mjs` | Renders every sound offline through the game's own audio code and checks loudness, clipping, tails and length (needs Chromium; run it when you touch `src/lib/sound`) |

`TEST_DATABASE_URL=<superuser url> npm run test:db` uses your own Postgres instead of Docker.
[CI](.github/workflows/ci.yml) runs all of it on every push and pull request.

## Project structure

```
supabase/migrations/   the engine: tables, rules, bots and API in a single migration
src/lib/               types (the server contract), API client, sync engine (polling / realtime / clock), preferences
src/lib/feel/ sound/ fx/   game feel: the event → sound/vibration/effects plan, the WebAudio synth, the effects canvas
src/hooks/             useRoom, useServerNow
src/components/game/   cards, hand, seats, table, action bar, reveal overlay, and the director that paces the story
src/components/shell/  logo, rules, toaster, error boundary, banners
src/pages/             home, lobby, join, game over, room switchboard
src/dev/ + dev/        fixtures for every game phase and a harness to preview screens without a backend
tests/db/              engine tests          tests/unit/   client logic          tests/e2e/   Playwright specs
scripts/               test-db.sh, dev-api.mjs, generate-brand-assets.mjs (logo, icons, screenshots, social images)
docs/                  game-feel.md, logo files, banner, social preview and the screenshots used here
```

## Troubleshooting

- **"The game server isn't set up yet"** — the migration hasn't been applied to the project in `VITE_SUPABASE_URL`.
- **Updates feel about a second slow** — Realtime is blocked, so the game polls instead. Nothing is broken.
- **"You're not part of this room" after clearing site data** — your device token is gone; join a lobby again or ask the
  host to start a new game.

## Built with

React 18 · TypeScript (strict) · Vite · Tailwind CSS · Framer Motion · Radix UI · Web Audio · Supabase (Postgres,
PostgREST, Realtime) · Vitest · Playwright · Vercel.

## Contributing

Bug reports, ideas and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 [Om Singh](https://github.com/omsingh02).

Fonts: [Inter](https://rsms.me/inter/) and [Unbounded](https://github.com/googlefonts/unbounded) (SIL Open Font License 1.1,
self-hosted via [Fontsource](https://fontsource.org)). Icons: [Lucide](https://lucide.dev) (ISC).
