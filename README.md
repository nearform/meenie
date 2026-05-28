# meeny

A Slack app that picks team members at random from channels or custom lists. MVP clone of [eeny.io](https://eeny.io/).

## Status

**Story F1 (Foundation) — in progress.** Subsequent stories are split for 2-agent parallel execution; see [the execution plan](../../../../../.cursor/plans/eeny_clone_mvp_scope_429232ca.plan.md) for the full breakdown.

Wired right now:

- `/meeny help` (placeholder until P2b)
- OAuth install + redirect endpoints
- Postgres connection + migration runner
- `teams` table

Not yet wired (parallel work):

| Story | Owner | Subcommand / surface             | Status  |
|-------|-------|----------------------------------|---------|
| P1a   | A     | `/meeny pick #channel` + button  | pending |
| P1b   | B     | `/meeny list ...` + lists schema | pending |
| P2a   | A     | `/meeny stats` + picks audit log | pending |
| P2b   | B     | Landing page + proper `help`     | pending |
| P3a   | A     | Dockerfile + compose + docs      | pending |
| P3b   | B     | Test suite                       | pending |

## Local setup

```bash
pnpm install
cp .env.example .env
# Edit .env: fill in SLACK_* values from the Slack app you create below.

# Start Postgres (P3a will provide docker-compose; for now bring your own)
createdb meeny

pnpm migrate
pnpm dev
```

The app listens on `http://localhost:3000` and exposes:

- `GET  /`                       — landing page (placeholder until P2b)
- `GET  /healthz`                — liveness probe
- `POST /slack/events`           — all Slack events, commands, interactions
- `GET  /slack/install`          — kicks off OAuth install
- `GET  /slack/oauth_redirect`   — OAuth callback

## Creating the Slack app

1. Run `ngrok http 3000` (or any HTTPS tunnel) and copy the public URL.
2. In `app.manifest.json` replace every `REPLACE_ME.ngrok-free.app` with your tunnel host.
3. At https://api.slack.com/apps, click **Create New App → From an app manifest**, paste the file.
4. Install the app to your workspace. Copy `Signing Secret`, `Client ID`, `Client Secret`, and `Bot Token` into `.env`.
5. Restart `pnpm dev` and run `/meeny help` in any channel.

## How parallel agents extend this codebase

The frozen contracts established in F1:

- **`src/types.ts`** — `TeamId`, `SlackUserId`, `ChannelId`, `ListId`, `Scope`, `RandomFn`. Do not edit inside a parallel phase.
- **`src/db.ts`** — use `query`, `queryOne`, `withTransaction`. Do not import `pg.Pool` directly.
- **`src/slack.ts`** — use `getClientForTeam(teamId)` to call the Web API. Do not instantiate `WebClient` ad hoc.
- **`src/router.ts`** — register subcommands via `registerSubcommand(name, handler)`. Do not call `boltApp.command` directly.

### Adding a subcommand (P1a, P1b, P2a)

1. Create `src/handlers/<name>.ts`.
2. At the top of the file, call `registerSubcommand("<name>", async (ctx) => { ... })`.
3. Add a new alphabetically-sorted import line to `src/handlers/index.ts`.
4. Block Kit fragments go in `src/blocks/<name>.ts` so handlers stay thin.
5. Action handlers (Block Kit buttons, etc.) call `boltApp.action(...)` directly. Reserve action IDs with a `<subcommand>_<verb>` prefix to avoid collisions (e.g. `pick_again`).

### Adding a migration (P1b, P2a)

1. Pick the next reserved number: P1b owns `002_lists.sql`, P2a owns `003_picks.sql`.
2. Write idempotent SQL (`CREATE TABLE IF NOT EXISTS`, etc.).
3. Run `pnpm migrate`. The runner tracks applied files in the `_migrations` table.
4. Migrations run inside a transaction; failures roll back automatically.

### Branching

Each story works on `feat/<story-id>` branched off the foundation branch (`feat/f1-foundation`). Parallel pairs merge to an integration branch (`integration/phase-N`) at the end of each phase, after `pnpm build && pnpm test` is green.

## Reference

Feature checklist mirrors [eeny.io](https://eeny.io/): pick from channels or custom lists, fairness stats, automation via Slack `/remind`.
