"""Sync idempotency tests for duplicate event IDs."""

import asyncio
import json
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import NoteModel, User
from app.services.sync_service import SyncServicer
from gen import lifeos_pb2


def _ctx(user_id: str = "u_sync_test"):
    return SimpleNamespace(user_id=user_id)


def _run(coro):
    return asyncio.run(coro)


def test_sync_batch_duplicate_event_id_applies_once():
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
            event_payload = json.dumps(
                {
                    "id": "n-dup",
                    "title": "Deduped note",
                    "body": "same event twice",
                    "category": "note",
                }
            )
            req = lifeos_pb2.SyncBatchRequest(
                events=[
                    lifeos_pb2.SyncEvent(
                        id="dup-event-1",
                        type="note_upsert",
                        payload=event_payload,
                        created_at="2026-03-26T10:00:00Z",
                    ),
                    lifeos_pb2.SyncEvent(
                        id="dup-event-1",
                        type="note_upsert",
                        payload=event_payload,
                        created_at="2026-03-26T10:00:10Z",
                    ),
                ]
            )
            response = await servicer.Batch(req, _ctx())
            assert response.processed == 2
            assert list(response.failed) == []

            async with session_factory() as s:
                notes = (
                    await s.execute(
                        select(NoteModel).where(
                            NoteModel.user_id == "u_sync_test",
                            NoteModel.id == "n-dup",
                        )
                    )
                ).scalars().all()
                assert len(notes) == 1
        finally:
            sync_mod.async_session = original_session
            await engine.dispose()

    _run(_inner())
