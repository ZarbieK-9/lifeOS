#!/usr/bin/env bash
# Run on the server after the backend repo is updated (git reset --hard).
# Repo root = this backend project (not a monorepo).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_VERSION=$(git rev-parse --short HEAD)
BUILD_COMMIT=$(git rev-parse HEAD)
BUILD_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '{"version":"%s","commit":"%s","branch":"%s","buildTime":"%s"}\n' \
  "$BUILD_VERSION" "$BUILD_COMMIT" "$BUILD_BRANCH" "$BUILD_TIME" >build-info.json
echo "Build version: $BUILD_VERSION ($BUILD_COMMIT) on $BUILD_BRANCH at $BUILD_TIME"

[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
chmod +x generate.sh
export PATH="$PWD/.venv/bin:$PATH"
./generate.sh
set -a
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
set +a
.venv/bin/alembic upgrade head
sudo systemctl restart pm2-zarbie.service
