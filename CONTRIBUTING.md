# Contributing to Leery

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Set up

```bash
git clone https://github.com/omsingh02/leery.git && cd leery
npm ci
cp .env.example .env.local        # add your Supabase URL + publishable key (see README → Run it yourself)
npm run dev
```

No backend handy? `npm run dev:ui` previews every screen from fixtures with no backend at all.

## Before you open a pull request

```bash
npm run typecheck && npm run lint && npm test     # fast checks
npm run test:db                                   # engine tests against a throwaway Postgres (needs Docker)
npm run e2e                                       # drives the real UI against the real engine
node scripts/audio-check.mjs                      # only if you touched src/lib/sound (needs Chromium)
```

CI runs the same things. If you change game rules, bot behaviour or anything in `supabase/migrations`, add or update a
test in `tests/db/`.

## Where things live

- **Rules, bots, timers, security** — `supabase/migrations/*_engine.sql` (the server is the only referee). Never edit a
  migration that has already been applied: add a new one.
- **Client sync** — `src/lib/roomSync.ts` (polling at server deadlines, realtime pings, clock skew).
- **Screens** — `src/pages` and `src/components`; the server contract is `src/lib/types.ts`.
- **Game feel** — sound, vibration and visual effects: events and their plan in `src/lib/feel`, the synth in
  `src/lib/sound`, effects in `src/lib/fx`, and the director that paces the table in `src/components/game/director`.
  Read [docs/game-feel.md](docs/game-feel.md) first; it also covers the labs for auditioning changes.

## Ground rules

- Keep it simple and readable; match the surrounding style (TypeScript strict, ESLint clean).
- Don't commit secrets or `.env*` files.
- One logical change per pull request, with a short description of *why*.
- Be kind: this project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

By contributing you agree that your contribution is licensed under the project's [MIT license](LICENSE).
