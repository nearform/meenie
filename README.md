# meeny

**Pick someone at random in Slack.** From a channel, from a custom list, or whoever is around. Open-source, self-hosted, no SaaS lock-in.

```
/meeny pick #standup
> @alice is up.
> Picked 1 of 7 members in #standup     [ Pick again ]
```

Combine with Slack's built-in `/remind` and scheduled picks are free:

```
/remind #standup to /meeny pick every Monday at 9am
```

## Why meeny

- **Channels and custom lists.** Pick from `#standup`, or maintain a `frontend-team` list independent of channel membership.
- **Fairness stats.** Every pick is audited; `/meeny stats` shows who's been picked how often.
- **No SaaS.** Self-host on your own infra. One container plus Postgres. Runs comfortably on a $5 box.
- **Plays nicely with `/remind`.** No bespoke scheduler — Slack already has one.
- **Small.** ~1.5k LOC of TypeScript, one HTTP service, no exotic dependencies.

## Quickstart

The 60-second path with HTTPS tunnel included:

```bash
git clone <this-repo> meeny && cd meeny
cp .env.example .env                       # fill in NGROK_AUTHTOKEN
docker compose --profile tunnel up --build
docker compose logs ngrok                  # copy the https://… URL
```

Then create the Slack app:

1. Open `app.manifest.json`, replace every `REPLACE_ME.ngrok-free.app` with the URL from the ngrok logs.
2. At [api.slack.com/apps](https://api.slack.com/apps), click **Create New App → From an app manifest** and paste the file.
3. Install the app to your workspace.
4. Copy `Signing Secret`, `Client ID`, `Client Secret`, and the **Bot Token** into `.env`.
5. `docker compose --profile tunnel up` again. Run `/meeny help` in any Slack channel.

Prefer running on the host directly? See [Local development](#local-development).

## Commands

| Command | What it does |
|---|---|
| `/meeny pick #channel` | Picks a random active, non-bot member of `#channel`. |
| `/meeny pick @listname` | Picks from a custom list. |
| `/meeny pick` | Picks from the channel you ran it in. |
| `/meeny list create my-team` | Creates a new custom list. |
| `/meeny list add my-team @alice @bob` | Adds members. |
| `/meeny list remove my-team @bob` | Removes members. |
| `/meeny list show my-team` | Shows the list. |
| `/meeny list delete my-team` | Deletes the list. |
| `/meeny list` | Lists every list in this workspace. |
| `/meeny stats #channel` | Shows pick counts over the last 30 days. |
| `/meeny stats @listname` | Same, for a custom list. |
| `/meeny help` | Full command help inside Slack. |

Every pick result has a **Pick again** button — re-rolls without retyping the command.

## Architecture

A single Node service. No queue, no Redis, no cron — scheduling is delegated to Slack's `/remind`.

- **[@slack/bolt](https://docs.slack.dev/tools/bolt-js)** through its `ExpressReceiver`. Slack events, slash commands, OAuth, and interactivity all land on `/slack/events`.
- **Express 5** serves the landing page at `/` and `GET /healthz`.
- **Postgres** for state: workspaces, lists, picks audit log. Raw-SQL migrations in [`migrations/`](./migrations/), applied on container start.
- **Zod-validated env** so misconfiguration fails at startup, not at first request.

```text
src/
  config.ts        zod-validated env
  db.ts            pool + query / queryOne / withTransaction
  slack.ts         Bolt + ExpressReceiver + installation store
  router.ts        /meeny dispatcher + registerSubcommand
  server.ts        entry point
  types.ts         Scope, TeamId, SlackUserId, ...
  picker/          pure pick(rng, ...) + pickFromChannel / pickFromList
  lists/           CRUD service + resolveListMembers
  stats/           recordPicks + getStats audit
  handlers/        one file per /meeny subcommand
  blocks/          Block Kit fragment builders
```

Single replica is fine; the OAuth installation store is in-memory for now (see [Production deploy notes](#production-deploy-notes) before horizontally scaling).

## Local development

```bash
docker compose up -d db   # Postgres only
./scripts/dev.sh          # bootstrap .env, install, migrate, watch-run
```

`scripts/dev.sh` is idempotent. First run copies `.env.example` to `.env` and stops so you can fill in `SLACK_*`. Re-run and it goes live.

Day-to-day:

```bash
pnpm dev          # tsx watch src/server.ts
pnpm test         # vitest run (83 tests, ~500ms, fully mocked, no DB needed)
pnpm typecheck    # tsc --noEmit
pnpm migrate      # apply any new migrations to the configured DB
```

### Contracts you shouldn't break

The codebase is small enough that a handful of conventions keep it that way:

| Module | Use | Not |
|---|---|---|
| `src/db.ts` | `query`, `queryOne`, `withTransaction` | `pg.Pool` directly |
| `src/slack.ts` | `getClientForTeam(teamId)` | `new WebClient(...)` ad hoc |
| `src/router.ts` | `registerSubcommand(name, handler)` | `boltApp.command("/meeny", ...)` |
| `src/types.ts` | `Scope`, `TeamId`, `SlackUserId`, ... | freelance string types |

Action handlers (button clicks, etc.) call `boltApp.action(...)` directly with action IDs prefixed `<subcommand>_<verb>` to avoid collisions (e.g. `pick_again`).

### Adding a subcommand

1. Create `src/handlers/<name>.ts`.
2. Call `registerSubcommand("<name>", async (ctx) => { ... })` at module load.
3. Add an alphabetically sorted import to `src/handlers/index.ts`.
4. Put Block Kit fragments in `src/blocks/<name>.ts` so handlers stay thin.

### Adding a migration

1. Create the next-numbered `migrations/00N_<topic>.sql`.
2. Use idempotent DDL (`CREATE TABLE IF NOT EXISTS`, etc.) so re-running is safe.
3. `pnpm migrate` applies anything new. The `_migrations` table tracks what's been applied; each migration runs in its own transaction.

## Production deploy notes

The container is intentionally boring — any platform that can run an OCI image and a Postgres database will do.

### Required env vars

Validated by [`src/config.ts`](./src/config.ts) — the app refuses to start if anything is missing.

| Variable | Notes |
|---|---|
| `PORT` | Defaults to `3000`. |
| `APP_BASE_URL` | Public HTTPS URL of the app. Used in OAuth redirects. |
| `DATABASE_URL` | Managed/persistent Postgres connection string. |
| `SLACK_SIGNING_SECRET` | From the Slack app's **Basic Information** page. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | OAuth credentials. |
| `SLACK_STATE_SECRET` | 32+ random chars. `openssl rand -hex 32`. |
| `SLACK_BOT_TOKEN` | Optional; single-workspace dev shortcut. |
| `NODE_ENV` | `production`. |

### Operational expectations

- **HTTPS is mandatory.** Slack rejects plain HTTP request URLs. Terminate TLS at a load balancer; the app itself speaks plain HTTP on `PORT`.
- **Persistent Postgres.** Compose uses a named volume for local use; production should point `DATABASE_URL` at RDS / Cloud SQL / Neon / similar. Migrations apply on every container start and are safe to re-run.
- **Runs as non-root** (uid 1000). Kubernetes `runAsNonRoot: true` is honoured.
- **Health probe:** `GET /healthz`. Already wired into the Docker `HEALTHCHECK`.
- **Single replica only** until the in-memory installation store is swapped for a shared one (Postgres-backed). Horizontal scale would split OAuth installs across pods.
- **No secrets in images.** `.env` is in `.dockerignore`; only `.env.example` ships. Inject real secrets via your platform's secret manager.

### Docker day-to-day

```bash
docker compose up --build              # foreground with rebuild
docker compose up -d                   # detached
docker compose logs -f app             # follow app logs
docker compose exec app pnpm migrate   # re-run migrations on demand
docker compose down                    # stop everything (volume kept)
docker compose down -v                 # stop + drop the Postgres volume
```

## Roadmap

PRs welcome.

- **Weighted "fair" picks** — favour members picked less recently. The `picks` audit table already has everything needed.
- **Postgres-backed installation store** — unlocks multi-replica deployments and proper multi-workspace OAuth at scale.
- **Pick reasons** — `/meeny pick #standup "lead today's standup"` echoes the reason in the result message.
- **Per-channel defaults** — `/meeny config #standup default-list @frontend-team`.
- **Slack App Directory listing** — for the hosted SaaS path.

## License

MIT. Built as an open-source counterpart to [eeny.io](https://eeny.io/), with thanks to its UX for the cue.
