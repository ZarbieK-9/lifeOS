"""SyncService gRPC implementation — batch offline queue drain."""

import json
from datetime import datetime, timezone

from app.db import async_session
from app.models import Task, HydrationLog, AiCommandModel, PartnerSnippetModel
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
                payload = json.loads(event.payload) if event.payload else {}
                await self._process_event(user_id, event.type, payload, event.created_at)
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
