"""ApiKeyService gRPC implementation — CRUD for per-user API keys."""

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import async_session
from app.models import ApiKeyModel
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc


def _hash_api_key(key: str) -> str:
    """SHA-256 hash of the plaintext API key."""
    return hashlib.sha256(key.encode()).hexdigest()


def _generate_api_key() -> str:
    """Generate a 32-byte (64 hex char) secure random API key."""
    return secrets.token_hex(32)


def _key_to_proto(k: ApiKeyModel) -> lifeos_pb2.ApiKeyInfo:
    return lifeos_pb2.ApiKeyInfo(
        key_id=k.key_id,
        name=k.name,
        created_at=str(k.created_at) if k.created_at else "",
        last_used=str(k.last_used) if k.last_used else "",
        key_prefix=k.key_prefix or "",
    )


class ApiKeyServicer(lifeos_pb2_grpc.ApiKeyServiceServicer):
    async def Create(self, request, context):
        user_id = context.user_id
        key_id = generate_id()
        plaintext_key = _generate_api_key()
        key_hash = _hash_api_key(plaintext_key)
        key_prefix = plaintext_key[:8]
        name = request.name or "default"
        now = datetime.now(timezone.utc)

        async with async_session() as session:
            api_key = ApiKeyModel(
                key_id=key_id,
                user_id=user_id,
                key_hash=key_hash,
                key_prefix=key_prefix,
                name=name,
                created_at=now,
            )
            session.add(api_key)
            await session.commit()

        return lifeos_pb2.CreateApiKeyResponse(
            key_id=key_id,
            api_key=plaintext_key,
            name=name,
            created_at=str(now),
        )

    async def List(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(ApiKeyModel)
                .where(ApiKeyModel.user_id == user_id)
                .order_by(ApiKeyModel.created_at.desc())
            )
            keys = result.scalars().all()
            return lifeos_pb2.ListApiKeysResponse(
                keys=[_key_to_proto(k) for k in keys]
            )

    async def Revoke(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(ApiKeyModel)
                .where(ApiKeyModel.key_id == request.key_id)
                .where(ApiKeyModel.user_id == user_id)
            )
            key = result.scalar_one_or_none()
            if key:
                await session.delete(key)
                await session.commit()
            return lifeos_pb2.Empty()
