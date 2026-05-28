# meeny

A Slack app that picks team members at random from channels or custom lists. MVP clone of [eeny.io](https://eeny.io/).

## Status

MVP is feature-complete. Phases F1 through P3 are merged on `main`; the only outstanding work is **I1 — end-to-end smoke against a real Slack workspace** (manual, requires an actual install).

| Story | Owner | Surface                          | Status    |
|-------|-------|----------------------------------|-----------|
| F1    | -     | Foundation, frozen contracts     | merged    |
| P1a   | A     | `/meeny pick #channel`/`@list`   | merged    |
| P1b   | B     | `/meeny list ...` + lists schema | merged    |
| P2a   | A     | `/meeny stats` + picks audit log | merged    |
| P2b   | B     | Landing page + Block Kit `help`  | merged    |
| P3a   | A     | Dockerfile + compose + docs      | merged    |
| P3b   | B     | Vitest suite (83 tests)          | merged    |
| I1    | -     | E2E smoke + tag `v0.1.0`         | pending   |

See [the execution plan](../../../../../.cursor/plans/eeny_clone_mvp_scope_429232ca.plan.md) for the original phasing.

## Local setup

The fast path — Postgres in Docker, app on host:

```bash
docker compose up -d db   # start Postgres only
./scripts/dev.sh          # bootstrap .env, install deps, migrate, run dev
```

`scripts/dev.sh` is idempotent: on the first run it copies `.env.example` to
`.env` and exits so you can fill in the `SLACK_*` values; subsequent runs
install deps, apply migrations, and start the dev server with watch mode.

Manual fallback (no helper script):

```bash
pnpm install
cp .env.example .env
# Edit .env: fill in SLACK_* values from the Slack app you create below.

# Start Postgres any way you like (compose, brew services, native install, …):
docker compose up -d db
# or: createdb meeny

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

The simplest way to get an HTTPS URL with zero local install is the bundled
ngrok side-car: `docker compose --profile tunnel up` (see [Running with Docker](#running-with-docker)).

## Running with Docker

Everything you need is wired in `Dockerfile` + `docker-compose.yml`:

```bash
cp .env.example .env       # fill in SLACK_* values
docker compose up --build  # builds the app image, starts db + app
```

What this does:

- Brings up `db` (`postgres:18-alpine`) with a named volume `meeny_pgdata` for
  durable storage. The `app` container will not start until `pg_isready`
  reports the database is healthy (managed via the compose `healthcheck` +
  `depends_on: condition: service_healthy`).
- Builds the `app` image from `Dockerfile` (multi-stage, runs as the `node`
  user, healthchecks `/healthz`).
- On every `app` container start, `scripts/docker-entrypoint.sh` runs
  `pnpm migrate` then `exec pnpm start`. Migrations are idempotent (they're
  tracked in the `_migrations` table), so this is safe to repeat.
- Exposes the app on `http://localhost:3000`. Postgres is **not** exposed to
  the host by default — uncomment the `ports:` block in `docker-compose.yml`
  if you need to connect from your host with `psql`.

### Public HTTPS via ngrok (optional)

Slack needs an HTTPS URL to call. The compose stack ships an optional `ngrok`
side-car behind the `tunnel` profile:

```bash
# put your ngrok auth token in .env (NGROK_AUTHTOKEN=…)
docker compose --profile tunnel up
docker compose logs ngrok            # find the public https URL in the logs
# or open http://localhost:4040 for ngrok's local inspector
```

Copy the printed `https://….ngrok-free.app` URL into `app.manifest.json`
(replacing every `REPLACE_ME.ngrok-free.app`) and reinstall the Slack app.

### Day-to-day commands

```bash
docker compose up --build         # foreground, with rebuild
docker compose up -d              # detached
docker compose logs -f app        # follow app logs
docker compose exec app pnpm migrate   # re-run migrations on demand
docker compose down               # stop everything (volume kept)
docker compose down -v            # stop + drop the postgres volume
```

## Production deploy notes

The container is intentionally boring — any platform that can run an
OCI image and a Postgres database will do.

**Required env vars** (read by [`src/config.ts`](./src/config.ts)):

| Variable                 | Notes                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `PORT`                   | Defaults to `3000`. Bind your load balancer to this port.            |
| `APP_BASE_URL`           | Public HTTPS URL of the app. Used in OAuth redirects.                |
| `DATABASE_URL`           | Postgres connection string. Use a managed/persistent instance.       |
| `SLACK_SIGNING_SECRET`   | From the Slack app's Basic Information page.                         |
| `SLACK_CLIENT_ID`        | OAuth client id.                                                     |
| `SLACK_CLIENT_SECRET`    | OAuth client secret.                                                 |
| `SLACK_STATE_SECRET`     | 32+ random chars. `openssl rand -hex 32`. Rotate carefully.          |
| `SLACK_BOT_TOKEN`        | Optional; only used in single-workspace dev mode.                    |
| `NODE_ENV`               | Set to `production`.                                                 |

**Operational expectations**:

- **HTTPS is mandatory** — Slack rejects plain HTTP request URLs. Terminate
  TLS at a load balancer / reverse proxy in front of the container; the app
  itself speaks plain HTTP on `PORT`.
- **Persistent Postgres**. The compose stack uses a named volume for local
  use; in production point `DATABASE_URL` at a managed Postgres (RDS,
  Cloud SQL, Neon, etc.). Migrations apply on every container start and are
  safe to re-run.
- **Run as non-root**. The image already drops to the `node` user (uid 1000).
  If you set Kubernetes `securityContext`, `runAsNonRoot: true` is honoured.
- **Liveness / readiness**. The image has a Docker `HEALTHCHECK` that hits
  `GET /healthz`. Wire your orchestrator's probes to the same endpoint.
- **Single replica for the MVP**. The OAuth installation store is currently
  in-memory (`MemoryInstallationStore`), so horizontal scaling would split
  installs across pods. Stick to one replica until a shared installation
  store is wired (out of scope for the MVP).
- **No secrets in images**. `.env` is listed in `.dockerignore`; only
  `.env.example` is shipped. Inject real secrets via your platform's secret
  manager.

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
