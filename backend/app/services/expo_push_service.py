"""Send Expo push notifications using stored device tokens."""

from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import delete, select

from app.db import async_session
from app.models import ExpoPushTokenModel

logger = logging.getLogger("lifeos.push")


async def send_expo_push_to_user(
    user_id: str,
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
) -> None:
    try:
        from exponent_server_sdk import DeviceNotRegisteredError, PushClient, PushMessage
    except ImportError:
        logger.warning("exponent_server_sdk not installed; skipping push")
        return

    payload = data or {}
    async with async_session() as session:
        rows = (
            await session.execute(
                select(ExpoPushTokenModel).where(ExpoPushTokenModel.user_id == user_id)
            )
        ).scalars().all()

    if not rows:
        return

    client = PushClient()
    for row in rows:
        token = (row.token or "").strip()
        if not token:
            continue
        try:
            client.publish(
                PushMessage(to=token, title=title, body=body, data=payload)
            )
        except DeviceNotRegisteredError:
            async with async_session() as session:
                await session.execute(
                    delete(ExpoPushTokenModel).where(ExpoPushTokenModel.id == row.id)
                )
                await session.commit()
            logger.info("Removed invalid Expo push token id=%s", row.id)
        except Exception as e:
            logger.warning("Expo push failed for token id=%s: %s", row.id, e)
