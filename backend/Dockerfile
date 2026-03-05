FROM python:3.12-slim

WORKDIR /app

# Install protoc for code generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Generate gRPC stubs from proto files
RUN python -m grpc_tools.protoc \
    -Iproto \
    --python_out=gen \
    --grpc_python_out=gen \
    --descriptor_set_out=/app/proto.pb \
    --include_imports \
    lifeos.proto \
    && sed -i 's/^import lifeos_pb2/from gen import lifeos_pb2/' gen/lifeos_pb2_grpc.py

# Health check endpoint via grpcurl would go here in production
EXPOSE 50051

CMD ["python", "-m", "app.server"]
