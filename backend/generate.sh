#!/bin/bash
# Generate Python gRPC stubs and Envoy proto descriptor from lifeos.proto

set -e

PROTO_DIR="$(cd "$(dirname "$0")" && pwd)/proto"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/gen"
ENVOY_DIR="$(cd "$(dirname "$0")/.." && pwd)/infra/envoy"

echo "Generating Python gRPC stubs..."
python -m grpc_tools.protoc \
  -I"$PROTO_DIR" \
  --python_out="$OUT_DIR" \
  --grpc_python_out="$OUT_DIR" \
  --descriptor_set_out="$ENVOY_DIR/proto.pb" \
  --include_imports \
  lifeos.proto

# Fix imports in generated files (use relative imports for gen package)
if [ -f "$OUT_DIR/lifeos_pb2_grpc.py" ]; then
  sed -i 's/^import lifeos_pb2/from gen import lifeos_pb2/' "$OUT_DIR/lifeos_pb2_grpc.py"
  echo "Fixed imports in lifeos_pb2_grpc.py"
fi

echo "Proto generation complete."
echo "  Python stubs: $OUT_DIR/lifeos_pb2.py, $OUT_DIR/lifeos_pb2_grpc.py"
echo "  Envoy descriptor: $ENVOY_DIR/proto.pb"
