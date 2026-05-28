#!/usr/bin/env bash
# One-shot local dev bootstrap: ensures .env exists, deps are installed,
# migrations are applied, then runs `pnpm dev`.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in the SLACK_* values and re-run scripts/dev.sh."
  exit 1
fi

pnpm install
pnpm migrate
exec pnpm dev
