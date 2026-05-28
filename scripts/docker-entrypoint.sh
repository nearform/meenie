#!/bin/sh
# Container entrypoint: apply pending migrations, then start the server.
# Used by docker-compose; the Dockerfile's CMD is `pnpm start` directly.
set -eu

pnpm migrate
exec pnpm start
