#!/bin/bash
# Fails when generated stubs drift from proto (run from backend repo root).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
"$ROOT/generate.sh"
cd "$ROOT"
if ! git diff --exit-code -- gen/lifeos_pb2.py gen/lifeos_pb2_grpc.py >/dev/null; then
  echo "Generated Python stubs are out of date. Run ./generate.sh and commit."
  git diff -- gen/lifeos_pb2.py gen/lifeos_pb2_grpc.py || true
  exit 1
fi

echo "Generated proto artifacts are up to date."
