"""
Server-side coach scheduler: morning / evening / weekly windows, deduped in coach_notifications.
Per-user IANA timezone from users.coach_timezone when set; else Settings.COACH_TIMEZONE.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import settings
from app.db import async_session
from app.models import CoachNotificationModel, User
from app.services.coach_generation_service import (
    format_evening_coach,
    format_morning_plan_notification_body,
    format_partner_weekly_prompt,
    format_weekly_coach_body,
    generate_evening_reflection,
    generate_morning_plan,
    generate_weekly_review,
)
from app.services.coach_patterns_service import analyze_and_persist_patterns, update_daily_streak
from app.services.expo_push_service import send_expo_push_to_user

logger = logging.getLogger("lifeos.coach_watcher")


def _default_coach_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.COACH_TIMEZONE)
    except Exception:
        return ZoneInfo("UTC")


def resolve_user_coach_zoneinfo(coach_timezone: Optional[str]) -> ZoneInfo:
    """IANA zone per user; invalid or empty falls back to COACH_TIMEZONE."""
    if coach_timezone:
        s = coach_timezone.strip()
        if s:
            try:
                return ZoneInfo(s)
            except Exception:
                pass
    return _default_coach_tz()


def _js_dow_sunday_zero(local_dt: datetime) -> int:
    """Match JavaScript Date.getDay(): Sunday=0 ... Saturday=6."""
    return (local_dt.weekday() + 1) % 7


async def _insert_coach_if_absent(
    notif_id: str,
    user_id: str,
    domain: str,
    title: str,
    body: str,
    priority: str,
    rule_id: str,
) -> bool:
    async with async_session() as session:
        existing = await session.get(CoachNotificationModel, notif_id)
        if existing:
            return False
        session.add(
            CoachNotificationModel(
                id=notif_id,
                user_id=user_id,
                domain=domain,
                title=title,
                body=body,
                priority=priority,
                read=False,
                acted_on=0,
                rule_id=rule_id,
            )
        )
        await session.commit()
    return True


async def run_coach_tick_for_user(user_id: str, local_now: datetime) -> None:
    hour = local_now.hour
    dow = _js_dow_sunday_zero(local_now)
    local_date = local_now.date().isoformat()

    in_morning = 7 <= hour <= 10
    in_evening = 20 <= hour <= 23
    in_weekly = dow == 0 and 19 <= hour <= 21

    if not (in_morning or in_evening or in_weekly):
        return

    await update_daily_streak(user_id, local_now=local_now)
    await analyze_and_persist_patterns(user_id)

    if in_morning:
        nid = f"{user_id}:morning_coach:{local_date}"
        plan = await generate_morning_plan(user_id, local_now)
        body = format_morning_plan_notification_body(plan)
        title = "Your morning plan is ready"
        if await _insert_coach_if_absent(
            nid, user_id, "productivity", title, body, "high", "morning_coach"
        ):
            await send_expo_push_to_user(
                user_id, title, body, {"rule_id": "morning_coach", "coach_notif_id": nid}
            )

    if in_evening:
        nid = f"{user_id}:evening_coach:{local_date}"
        reflection = await generate_evening_reflection(user_id, local_now)
        body = format_evening_coach(reflection)
        title = f"Evening coach - {reflection['score']}/100"
        if await _insert_coach_if_absent(
            nid, user_id, "productivity", title, body, "low", "evening_coach"
        ):
            await send_expo_push_to_user(
                user_id, title, body, {"rule_id": "evening_coach", "coach_notif_id": nid}
            )

    if in_weekly:
        wid = f"{user_id}:weekly_coach:{local_date}"
        review = await generate_weekly_review(user_id, local_now)
        body = format_weekly_coach_body(review)
        title = "Your week in review"
        if await _insert_coach_if_absent(
            wid, user_id, "productivity", title, body, "low", "weekly_coach"
        ):
            await send_expo_push_to_user(
                user_id, title, body, {"rule_id": "weekly_coach", "coach_notif_id": wid}
            )

        pid = f"{user_id}:partner_weekly_prompt:{local_date}"
        score = int(review.get("weekScore") or 0)
        pbody = format_partner_weekly_prompt(score)
        ptitle = "Optional: share progress"
        if await _insert_coach_if_absent(
            pid, user_id, "social", ptitle, pbody, "low", "partner_weekly_prompt"
        ):
            await send_expo_push_to_user(
                user_id,
                ptitle,
                pbody,
                {"rule_id": "partner_weekly_prompt", "coach_notif_id": pid},
            )


async def coach_cron_loop() -> None:
    logger.info(
        "Coach watcher started (default_tz=%s; per-user users.coach_timezone when set)",
        settings.COACH_TIMEZONE,
    )
    while True:
        try:
            async with async_session() as session:
                rows = (
                    await session.execute(select(User.user_id, User.coach_timezone))
                ).all()
            for uid, coach_tz in rows:
                try:
                    zi = resolve_user_coach_zoneinfo(coach_tz)
                    local_now = datetime.now(zi)
                    await run_coach_tick_for_user(uid, local_now)
                except Exception as e:
                    logger.exception("Coach tick failed user=%s: %s", uid, e)
        except Exception as e:
            logger.exception("Coach cron error: %s", e)
        await asyncio.sleep(60)
