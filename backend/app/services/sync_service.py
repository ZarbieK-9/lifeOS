"""SyncService gRPC implementation — batch offline queue drain."""

import json
from datetime import datetime, timezone

from app.db import async_session
from app.models import (
    User,
    Task,
    HydrationLog,
    AiCommandModel,
    PartnerSnippetModel,
    MoodLogModel,
    HabitModel,
    HabitLogModel,
    NoteModel,
    InboxItemModel,
    ExpenseModel,
    BudgetModel,
    BehaviorPatternModel,
    DailyStreakModel,
    CalendarEventModel,
    EmailCacheModel,
    EmailCategoryModel,
    CoachCommitmentModel,
    SleepSessionModel,
    SyncEventReceiptModel,
    AgentOutcomeModel,
)
from app.auth import generate_id
from app.services.partner_service import get_mqtt_client

from gen import lifeos_pb2, lifeos_pb2_grpc


class SyncServicer(lifeos_pb2_grpc.SyncServiceServicer):
    async def Batch(self, request, context):
        user_id = context.user_id
        processed = 0
        failed = []

        for event in request.events:
            try:
                async with async_session() as session:
                    from sqlalchemy import select

                    existing = await session.execute(
                        select(SyncEventReceiptModel).where(
                            SyncEventReceiptModel.user_id == user_id,
                            SyncEventReceiptModel.event_id == event.id,
                        )
                    )
                    if existing.scalar_one_or_none():
                        processed += 1
                        continue
                payload = json.loads(event.payload) if event.payload else {}
                await self._process_event(user_id, event.type, payload, event.created_at)
                async with async_session() as session:
                    session.add(
                        SyncEventReceiptModel(
                            id=generate_id(),
                            user_id=user_id,
                            event_id=event.id,
                            event_type=event.type,
                        )
                    )
                    await session.commit()
                processed += 1
            except Exception as e:
                print(f"[LifeOS] Sync event {event.id} failed: {e}")
                failed.append(event.id)

        return lifeos_pb2.SyncBatchResponse(
            processed=processed,
            failed=failed,
        )

    async def _process_event(
        self, user_id: str, event_type: str, payload: dict, created_at: str
    ):
        async with async_session() as session:
            if event_type == "hydration":
                log = HydrationLog(
                    log_id=payload.get("log_id", generate_id()),
                    user_id=user_id,
                    amount_ml=payload.get("amount_ml", 0),
                    timestamp=payload.get("timestamp", created_at),
                    synced=True,
                )
                session.add(log)
                await session.commit()

            elif event_type == "task_create":
                task = Task(
                    task_id=payload.get("task_id", generate_id()),
                    user_id=user_id,
                    title=payload.get("title", ""),
                    due_date=payload.get("due_date"),
                    priority=payload.get("priority", "medium"),
                    notes=payload.get("notes", ""),
                    status=payload.get("status", "pending"),
                    recurrence=payload.get("recurrence"),
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                session.add(task)
                await session.commit()

            elif event_type == "task_update":
                from sqlalchemy import select, update

                task_id = payload.get("task_id")
                if task_id:
                    fields = {
                        k: v
                        for k, v in payload.items()
                        if k not in ("task_id", "user_id", "created_at") and v
                    }
                    if fields:
                        fields["updated_at"] = datetime.now(timezone.utc)
                        await session.execute(
                            update(Task)
                            .where(Task.task_id == task_id, Task.user_id == user_id)
                            .values(**fields)
                        )
                        await session.commit()

            elif event_type == "task_delete":
                from sqlalchemy import delete

                task_id = payload.get("task_id")
                if task_id:
                    await session.execute(
                        delete(Task).where(
                            Task.task_id == task_id, Task.user_id == user_id
                        )
                    )
                    await session.commit()

            elif event_type == "ai_command":
                cmd = AiCommandModel(
                    id=payload.get("id", generate_id()),
                    user_id=user_id,
                    input=payload.get("input", ""),
                    output=payload.get("output"),
                    status=payload.get("status", "pending"),
                    created_at=datetime.now(timezone.utc),
                )
                session.add(cmd)
                await session.commit()

            elif event_type == "mqtt_publish":
                # Publish queued MQTT message on behalf of user
                topic = payload.get("topic", "")
                content = payload.get("content", "")
                mqtt = get_mqtt_client()
                if mqtt and topic:
                    msg = json.dumps(
                        {
                            "type": "snippet",
                            "from_user_id": user_id,
                            "content": content,
                            "timestamp": created_at,
                        }
                    )
                    mqtt.publish(topic, msg, qos=1)

                    # Also persist the snippet
                    partner_id = topic.split("/")[-1] if "/" in topic else ""
                    snippet = PartnerSnippetModel(
                        snippet_id=generate_id(),
                        user_id=user_id,
                        partner_id=partner_id,
                        content=content,
                        timestamp=created_at,
                        synced=True,
                    )
                    session.add(snippet)
                    await session.commit()

            # ── Coach/state replication (server-side full-state migration) ──

            elif event_type == "mood_log_upsert":
                log = MoodLogModel(
                    id=payload.get("id") or payload.get("log_id") or generate_id(),
                    user_id=user_id,
                    mood=payload.get("mood", 1),
                    energy=payload.get("energy", 1),
                    note=payload.get("note"),
                    logged_at=payload.get("logged_at") or payload.get("timestamp") or created_at,
                )
                await session.merge(log)
                await session.commit()

            elif event_type == "habit_upsert":
                habit = HabitModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    name=payload.get("name", ""),
                    icon=payload.get("icon", "✓"),
                    target_per_day=payload.get("target_per_day", 1),
                    unit=payload.get("unit"),
                    enabled=bool(payload.get("enabled", True)),
                    created_at=payload.get("created_at"),
                )
                await session.merge(habit)
                await session.commit()

            elif event_type == "habit_log_upsert":
                habit_log = HabitLogModel(
                    id=payload.get("id") or payload.get("log_id") or generate_id(),
                    user_id=user_id,
                    habit_id=payload.get("habit_id") or "",
                    value=payload.get("value", 1),
                    logged_at=payload.get("logged_at") or payload.get("timestamp") or created_at,
                )
                await session.merge(habit_log)
                await session.commit()

            elif event_type == "note_upsert":
                note = NoteModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    title=payload.get("title", ""),
                    body=payload.get("body", ""),
                    category=payload.get("category", "note"),
                    pinned=bool(payload.get("pinned", False)),
                    created_at=payload.get("created_at"),
                    updated_at=payload.get("updated_at"),
                )
                await session.merge(note)
                await session.commit()

            elif event_type == "note_delete":
                from sqlalchemy import delete

                note_id = payload.get("id")
                if note_id:
                    await session.execute(
                        delete(NoteModel).where(
                            NoteModel.id == note_id, NoteModel.user_id == user_id
                        )
                    )
                    await session.commit()

            elif event_type == "inbox_item_upsert":
                item = InboxItemModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    text=payload.get("text", ""),
                    triaged=bool(payload.get("triaged", False)),
                    triage_result=payload.get("triage_result"),
                    created_at=payload.get("created_at"),
                )
                await session.merge(item)
                await session.commit()

            elif event_type == "inbox_item_delete":
                from sqlalchemy import delete

                item_id = payload.get("id")
                if item_id:
                    await session.execute(
                        delete(InboxItemModel).where(
                            InboxItemModel.id == item_id,
                            InboxItemModel.user_id == user_id,
                        )
                    )
                    await session.commit()

            elif event_type == "expense_upsert":
                exp = ExpenseModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    amount=payload.get("amount", 0.0),
                    currency=payload.get("currency", "USD"),
                    category=payload.get("category", "other"),
                    description=payload.get("description"),
                    date=payload.get("date", created_at[:10] if created_at else ""),
                    created_at=payload.get("created_at"),
                )
                await session.merge(exp)
                await session.commit()

            elif event_type == "budget_upsert":
                b = BudgetModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    category=payload.get("category", ""),
                    monthly_limit=payload.get("monthly_limit", 0.0),
                    currency=payload.get("currency", "USD"),
                    created_at=payload.get("created_at"),
                )
                await session.merge(b)
                await session.commit()

            elif event_type == "behavior_pattern_upsert":
                bp = BehaviorPatternModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    domain=payload.get("domain", ""),
                    pattern_type=payload.get("pattern_type", ""),
                    description=payload.get("description", ""),
                    data=payload.get("data") if isinstance(payload.get("data"), str) else payload.get("data_json") or json.dumps(payload.get("data") or {}),
                    confidence=payload.get("confidence", 0.5),
                    sample_count=payload.get("sample_count", 0),
                    last_updated=payload.get("last_updated"),
                    created_at=payload.get("created_at"),
                )
                await session.merge(bp)
                await session.commit()

            elif event_type == "daily_streak_upsert":
                date = payload.get("date") or payload.get("day") or ""
                ds = DailyStreakModel(
                    user_id=user_id,
                    date=date,
                    hydration_met=payload.get("hydration_met", 0),
                    tasks_completed=payload.get("tasks_completed", 0),
                    sleep_logged=payload.get("sleep_logged", 0),
                    habits_done=payload.get("habits_done", 0),
                    score=payload.get("score", 0),
                )
                await session.merge(ds)
                await session.commit()

            elif event_type == "calendar_event_upsert":
                ce = CalendarEventModel(
                    event_id=payload.get("event_id") or payload.get("id") or generate_id(),
                    user_id=user_id,
                    summary=payload.get("summary", ""),
                    description=payload.get("description"),
                    location=payload.get("location"),
                    start_time=payload.get("start_time") or payload.get("start"),
                    end_time=payload.get("end_time") or payload.get("end"),
                    all_day=bool(payload.get("all_day", False)),
                    status=payload.get("status", "confirmed"),
                    html_link=payload.get("html_link"),
                    google_calendar_id=payload.get("google_calendar_id", "primary"),
                    synced_at=payload.get("synced_at") or created_at,
                    raw_json=payload.get("raw_json"),
                )
                await session.merge(ce)
                await session.commit()

            elif event_type == "calendar_event_delete":
                from sqlalchemy import delete

                event_id = payload.get("event_id") or payload.get("id")
                if event_id:
                    await session.execute(
                        delete(CalendarEventModel).where(
                            CalendarEventModel.event_id == event_id,
                            CalendarEventModel.user_id == user_id,
                        )
                    )
                    await session.commit()

            elif event_type == "email_upsert":
                email = EmailCacheModel(
                    message_id=payload.get("message_id") or payload.get("id") or generate_id(),
                    user_id=user_id,
                    thread_id=payload.get("thread_id", ""),
                    from_address=payload.get("from_address", ""),
                    subject=payload.get("subject", ""),
                    snippet=payload.get("snippet"),
                    date=payload.get("date", created_at[:10] if created_at else ""),
                    is_unread=bool(payload.get("is_unread", True)),
                    is_starred=bool(payload.get("is_starred", False)),
                    label_ids=payload.get("label_ids"),
                    body_text=payload.get("body_text"),
                    synced_at=payload.get("synced_at") or created_at,
                )
                await session.merge(email)
                await session.commit()

            elif event_type == "email_delete":
                from sqlalchemy import delete

                message_id = payload.get("message_id") or payload.get("id")
                if message_id:
                    await session.execute(
                        delete(EmailCacheModel).where(
                            EmailCacheModel.message_id == message_id,
                            EmailCacheModel.user_id == user_id,
                        )
                    )
                    await session.execute(
                        delete(EmailCategoryModel).where(
                            EmailCategoryModel.message_id == message_id,
                            EmailCategoryModel.user_id == user_id,
                        )
                    )
                    await session.commit()

            elif event_type == "email_category_upsert":
                cat = EmailCategoryModel(
                    message_id=payload.get("message_id") or payload.get("id") or generate_id(),
                    user_id=user_id,
                    category=payload.get("category", "fyi"),
                    extracted_tasks=payload.get("extracted_tasks"),
                    categorized_at=payload.get("categorized_at") or created_at,
                )
                await session.merge(cat)
                await session.commit()

            elif event_type == "coaching_commitment_upsert":
                cc = CoachCommitmentModel(
                    id=payload.get("id") or generate_id(),
                    user_id=user_id,
                    suggestion=payload.get("suggestion", ""),
                    reason=payload.get("reason"),
                    date_suggested=payload.get("date_suggested") or payload.get("dateSuggested"),
                    date_due=payload.get("date_due") or payload.get("dateDue"),
                    adopted=bool(payload.get("adopted", False)),
                    outcome=payload.get("outcome"),
                    created_at=payload.get("created_at"),
                )
                await session.merge(cc)
                await session.commit()

            elif event_type == "user_settings_upsert":
                tz = payload.get("coach_timezone")
                if tz is not None:
                    row = await session.get(User, user_id)
                    if row:
                        s = str(tz).strip()
                        row.coach_timezone = s if s else None
                        await session.commit()

            elif event_type == "user_settings_clear":
                fields = payload.get("fields")
                if isinstance(fields, list) and "coach_timezone" in fields:
                    row = await session.get(User, user_id)
                    if row:
                        row.coach_timezone = None
                        await session.commit()

            elif event_type == "sleep_session_upsert":
                sid = payload.get("session_id") or generate_id()
                ss = SleepSessionModel(
                    session_id=sid,
                    user_id=user_id,
                    sleep_start=payload.get("sleep_start") or "",
                    sleep_end=payload.get("sleep_end"),
                    duration_minutes=int(payload.get("duration_minutes", 0) or 0),
                )
                await session.merge(ss)
                await session.commit()

            elif event_type == "sleep_session_delete":
                from sqlalchemy import delete

                sid = payload.get("session_id") or payload.get("id")
                if sid:
                    await session.execute(
                        delete(SleepSessionModel).where(
                            SleepSessionModel.session_id == sid,
                            SleepSessionModel.user_id == user_id,
                        )
                    )
                    await session.commit()

            elif event_type == "agent_outcome":
                row = AgentOutcomeModel(
                    id=generate_id(),
                    user_id=user_id,
                    source=str(payload.get("source") or "unknown"),
                    tool=str(payload.get("tool") or "unknown"),
                    outcome=str(payload.get("outcome") or "unknown"),
                )
                session.add(row)
                await session.commit()
