"""PushNotificationService — register Expo push token (persisted per device)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.auth import generate_id
from app.db import async_session
from app.models import ExpoPushTokenModel

from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos")


class PushNotificationServicer(lifeos_pb2_grpc.PushNotificationServiceServicer):
    async def RegisterPushToken(self, request, context):
        user_id = getattr(context, "user_id", None)
        token = (request.token or "").strip()
        if not user_id or not token:
            return lifeos_pb2.Empty()

        async with async_session() as session:
            res = await session.execute(
                select(ExpoPushTokenModel).where(
                    ExpoPushTokenModel.user_id == user_id,
                    ExpoPushTokenModel.token == token,
                )
            )
            existing = res.scalars().first()
            now = datetime.now(timezone.utc)
            if existing:
                existing.device_id = request.device_id or existing.device_id
                existing.platform = request.platform or existing.platform
                existing.created_at = now
                session.add(existing)
            else:
                session.add(
                    ExpoPushTokenModel(
                        id=generate_id(),
                        user_id=user_id,
                        device_id=request.device_id or None,
                        token=token,
                        platform=request.platform or None,
                        created_at=now,
                    )
                )
            await session.commit()

        logger.info(
            "[Push] Registered token user=%s platform=%s",
            user_id,
            request.platform,
        )
        return lifeos_pb2.Empty()
