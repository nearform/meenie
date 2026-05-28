# syntax=docker/dockerfile:1.7
#
# Multi-stage build for meeny.
#
# Layout:
#   deps     -> production dependencies only (small, cache-friendly)
#   tsx      -> the tsx runtime executor (kept out of prod node_modules)
#   runtime  -> the final non-root image that ships
#
# We do not transpile: tsx executes the .ts sources directly.

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=10.28.2
ARG TSX_VERSION=4.22.3

# ---------- Stage: deps -------------------------------------------------------
# Install ONLY production dependencies, using pnpm's content-addressed store
# so the layer is reused as long as package.json + pnpm-lock.yaml are unchanged.
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
ENV CI=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --prod
RUN pnpm install --prod --frozen-lockfile --offline


# ---------- Stage: tsx --------------------------------------------------------
# tsx is a devDependency in package.json but is the chosen runtime executor
# (`pnpm start` -> `tsx src/server.ts`). We grab it via a global npm install in
# its own stage so we can copy a clean, fully-resolved tsx tree into runtime
# without polluting prod node_modules with the rest of the dev deps.
FROM ${NODE_IMAGE} AS tsx
ARG TSX_VERSION
RUN npm install --global --omit=dev --no-fund --no-audit tsx@${TSX_VERSION}


# ---------- Stage: runtime ----------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG PNPM_VERSION

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Production dependencies (no devDeps, no tsx).
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# tsx runtime (CLI on PATH at /usr/local/bin/tsx).
COPY --from=tsx /usr/local/lib/node_modules/tsx /usr/local/lib/node_modules/tsx
COPY --from=tsx /usr/local/bin/tsx /usr/local/bin/tsx

# Project sources. Copied last so source edits don't bust the deps layer.
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node package.json tsconfig.json ./

RUN chmod +x scripts/docker-entrypoint.sh scripts/dev.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/healthz || exit 1

# Default command: start the server. docker-compose overrides the entrypoint
# to run migrations first via scripts/docker-entrypoint.sh.
CMD ["pnpm", "start"]
