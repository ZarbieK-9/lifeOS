"""Sync batch ingestion tests for mobile-enqueued event types."""

import asyncio
import json
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import (
    CalendarEventModel,
    EmailCacheModel,
    InboxItemModel,
    NoteModel,
    SleepSessionModel,
    User,
)
from app.services.sync_service import SyncServicer
from gen import lifeos_pb2


def _ctx(user_id: str = "u_sync_test"):
    return SimpleNamespace(user_id=user_id)


def _run(coro):
    return asyncio.run(coro)


def test_sync_ingests_upserts_and_deletes():
    async def _inner():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_factory() as s:
            s.add(User(user_id="u_sync_test", username="sync_user", password_hash="x"))
            await s.commit()

        servicer = SyncServicer()
        import app.services.sync_service as sync_mod

        original_session = sync_mod.async_session
        sync_mod.async_session = session_factory
        try:
            created_at = "2026-03-26T10:00:00Z"
            await servicer._process_event(
                "u_sync_test",
                "note_upsert",
                {
                    "id": "n1",
                    "title": "Note 1",
                    "body": "body",
                    "category": "note",
                    "created_at": created_at,
                    "updated_at": created_at,
                },
                created_at,
            )
            await servicer._process_event(
                "u_sync_test",
                "inbox_item_upsert",
                {"id": "i1", "text": "inbox", "triaged": False, "created_at": created_at},
                created_at,
            )
            await servicer._process_event(
                "u_sync_test",
                "calendar_event_upsert",
                {
                    "event_id": "c1",
                    "summary": "Calendar",
                    "start_time": "2026-03-26T11:00:00Z",
                    "end_time": "2026-03-26T11:30:00Z",
                    "status": "confirmed",
                },
                created_at,
            )
            await servicer._process_event(
                "u_sync_test",
                "email_upsert",
                {
                    "message_id": "e1",
                    "thread_id": "t1",
                    "from_address": "a@b.com",
                    "subject": "subject",
                    "date": "2026-03-26",
                    "is_unread": True,
                    "is_starred": False,
                },
                created_at,
            )
            await servicer._process_event(
                "u_sync_test",
                "sleep_session_upsert",
                {
                    "session_id": "s1",
                    "sleep_start": "2026-03-26T00:00:00Z",
                    "sleep_end": "2026-03-26T08:00:00Z",
                    "duration_minutes": 480,
                },
                created_at,
            )
            await servicer._process_event(
                "u_sync_test",
                "user_settings_upsert",
                {"coach_timezone": "America/New_York"},
                created_at,
            )

            async with session_factory() as s:
                assert await s.get(NoteModel, "n1") is not None
                assert await s.get(InboxItemModel, "i1") is not None
                assert await s.get(CalendarEventModel, "c1") is not None
                assert await s.get(EmailCacheModel, "e1") is not None
                assert await s.get(SleepSessionModel, "s1") is not None
                user = await s.get(User, "u_sync_test")
                assert user is not None
                assert user.coach_timezone == "America/New_York"

            await servicer._process_event("u_sync_test", "note_delete", {"id": "n1"}, created_at)
            await servicer._process_event(
                "u_sync_test", "inbox_item_delete", {"id": "i1"}, created_at
            )
            await servicer._process_event(
                "u_sync_test", "calendar_event_delete", {"event_id": "c1"}, created_at
            )
            await servicer._process_event(
                "u_sync_test", "email_delete", {"message_id": "e1"}, created_at
            )
            await servicer._process_event(
                "u_sync_test", "sleep_session_delete", {"session_id": "s1"}, created_at
            )
            await servicer._process_event(
                "u_sync_test", "user_settings_clear", {"fields": ["coach_timezone"]}, created_at
            )

            async with session_factory() as s:
                assert await s.get(NoteModel, "n1") is None
                assert await s.get(InboxItemModel, "i1") is None
                assert await s.get(CalendarEventModel, "c1") is None
                assert await s.get(EmailCacheModel, "e1") is None
                assert await s.get(SleepSessionModel, "s1") is None
                user = await s.get(User, "u_sync_test")
                assert user is not None
                assert user.coach_timezone is None
        finally:
            sync_mod.async_session = original_session
            await engine.dispose()

    _run(_inner())


def test_sync_batch_partial_failure_tracks_failed_ids():
    async def _inner():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_factory() as s:
            s.add(User(user_id="u_sync_test", username="sync_user", password_hash="x"))
            await s.commit()

        servicer = SyncServicer()
        import app.services.sync_service as sync_mod

        original_session = sync_mod.async_session
        sync_mod.async_session = session_factory
        try:
            request = lifeos_pb2.SyncBatchRequest(
                events=[
                    lifeos_pb2.SyncEvent(
                        id="ok-1",
                        type="note_upsert",
                        payload=json.dumps(
                            {
                                "id": "n2",
                                "title": "Works",
                                "body": "",
                                "category": "note",
                            }
                        ),
                        created_at="2026-03-26T10:00:00Z",
                    ),
                    lifeos_pb2.SyncEvent(
                        id="bad-1",
                        type="note_upsert",
                        payload="{not-json}",
                        created_at="2026-03-26T10:00:00Z",
                    ),
                ]
            )
            response = await servicer.Batch(request, _ctx())
            assert response.processed == 1
            assert list(response.failed) == ["bad-1"]

            async with session_factory() as s:
                row = await s.get(NoteModel, "n2")
                assert row is not None
                count = (
                    await s.execute(select(NoteModel).where(NoteModel.user_id == "u_sync_test"))
                ).scalars().all()
                assert len(count) == 1
        finally:
            sync_mod.async_session = original_session
            await engine.dispose()

    _run(_inner())
