#!/bin/bash
# Fails when generated gRPC/descriptor artifacts drift from proto source.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/backend/generate.sh"

cd "$ROOT_DIR"
if ! git diff --exit-code -- backend/gen/lifeos_pb2.py backend/gen/lifeos_pb2_grpc.py >/dev/null; then
  echo "Generated Python stubs are out of date. Run backend/generate.sh and commit the results."
  git diff -- backend/gen/lifeos_pb2.py backend/gen/lifeos_pb2_grpc.py || true
  exit 1
fi

echo "Generated proto artifacts are up to date."
