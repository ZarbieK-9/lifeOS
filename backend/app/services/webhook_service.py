"""WebhookService gRPC implementation — API-key authenticated command endpoint."""

import hashlib
import logging
from datetime import datetime, timezone

import grpc
from sqlalchemy import select

from app.db import async_session
from app.models import ApiKeyModel, AiCommandModel, WebhookReplayGuardModel
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos.webhook")


def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _resolve_user_from_api_key(api_key: str) -> str | None:
    """Look up user_id from a plaintext API key. Returns None if invalid."""
    key_hash = _hash_api_key(api_key)
    async with async_session() as session:
        result = await session.execute(
            select(ApiKeyModel).where(ApiKeyModel.key_hash == key_hash)
        )
        row = result.scalar_one_or_none()
        if row:
            row.last_used = datetime.now(timezone.utc)
            await session.commit()
            return row.user_id
    return None


class WebhookServicer(lifeos_pb2_grpc.WebhookServiceServicer):
    async def Command(self, request, context):
        # Extract API key from metadata (Envoy forwards HTTP headers as gRPC metadata)
        metadata = dict(context.invocation_metadata() or [])
        api_key = metadata.get("x-api-key", "")
        request_id = metadata.get("x-request-id", "")

        if not api_key:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            context.set_details("Missing X-API-Key header")
            return lifeos_pb2.WebhookCommandResponse()

        user_id = await _resolve_user_from_api_key(api_key)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            context.set_details("Invalid API key")
            return lifeos_pb2.WebhookCommandResponse()

        if request_id:
            async with async_session() as session:
                existing = await session.execute(
                    select(WebhookReplayGuardModel).where(
                        WebhookReplayGuardModel.user_id == user_id,
                        WebhookReplayGuardModel.request_id == request_id,
                    )
                )
                if existing.scalar_one_or_none():
                    return lifeos_pb2.WebhookCommandResponse(
                        output="Duplicate webhook request ignored.",
                        status="duplicate",
                    )
                session.add(
                    WebhookReplayGuardModel(
                        id=generate_id(),
                        user_id=user_id,
                        request_id=request_id,
                    )
                )
                await session.commit()

        text = request.input
        if not text:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Input text is required")
            return lifeos_pb2.WebhookCommandResponse()
        if len(text) > 1000:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Input too long")
            return lifeos_pb2.WebhookCommandResponse()

        # Reuse existing AI dispatch
        from app.services.ai_service import _dispatch_tool

        try:
            output, status = await _dispatch_tool(user_id, text)
        except Exception as e:
            logger.error(f"Webhook dispatch error: {e}")
            output = f"Error: {e}"
            status = "failed"

        # Log to ai_commands for history/audit
        cmd_id = generate_id()
        now = datetime.now(timezone.utc)
        async with async_session() as session:
            cmd = AiCommandModel(
                id=cmd_id, user_id=user_id,
                input=text, output=output, status=status, created_at=now,
            )
            session.add(cmd)
            await session.commit()

        logger.info(f"Webhook command from user {user_id[:8]}...: {text[:50]}")
        return lifeos_pb2.WebhookCommandResponse(output=output, status=status)
