"""PartnerService gRPC implementation."""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import async_session
from app.models import PartnerSnippetModel
from app.auth import generate_id
from app.config import settings

from gen import lifeos_pb2, lifeos_pb2_grpc

# Server-side MQTT client for publishing snippets to broker
_mqtt_client = None


def get_mqtt_client():
    """Lazy-init MQTT client for server-side publishing."""
    global _mqtt_client
    if _mqtt_client is None:
        import paho.mqtt.client as paho_mqtt

        _mqtt_client = paho_mqtt.Client(
            paho_mqtt.CallbackAPIVersion.VERSION2,
            client_id="lifeos_server",
        )
        _mqtt_client.username_pw_set(
            settings.MQTT_USERNAME, settings.MQTT_PASSWORD
        )
        try:
            _mqtt_client.connect(settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT)
            _mqtt_client.loop_start()
        except Exception as e:
            print(f"[LifeOS] MQTT connect failed: {e}")
            _mqtt_client = None
    return _mqtt_client


def _snippet_to_proto(s: PartnerSnippetModel) -> lifeos_pb2.PartnerSnippet:
    return lifeos_pb2.PartnerSnippet(
        snippet_id=s.snippet_id,
        user_id=s.user_id,
        partner_id=s.partner_id,
        content=s.content or "",
        timestamp=s.timestamp or "",
        synced=True,
    )


class PartnerServicer(lifeos_pb2_grpc.PartnerServiceServicer):
    async def ListSnippets(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(PartnerSnippetModel)
                .where(PartnerSnippetModel.user_id == user_id)
                .order_by(PartnerSnippetModel.timestamp.desc())
                .limit(50)
            )
            snippets = result.scalars().all()
            return lifeos_pb2.ListSnippetsResponse(
                snippets=[_snippet_to_proto(s) for s in snippets]
            )

    async def SendSnippet(self, request, context):
        user_id = context.user_id
        snippet_id = request.snippet_id or generate_id()
        ts = request.timestamp or datetime.now(timezone.utc).isoformat()

        async with async_session() as session:
            snippet = PartnerSnippetModel(
                snippet_id=snippet_id,
                user_id=user_id,
                partner_id=request.partner_id,
                content=request.content,
                timestamp=ts,
                synced=True,
            )
            session.add(snippet)
            await session.commit()
            await session.refresh(snippet)

        # Publish to MQTT broker for real-time delivery
        mqtt = get_mqtt_client()
        if mqtt:
            msg = json.dumps(
                {
                    "type": "snippet",
                    "from_user_id": user_id,
                    "content": request.content,
                    "timestamp": ts,
                }
            )
            mqtt.publish(
                f"partner/snippet/{request.partner_id}",
                msg,
                qos=1,
            )

        return _snippet_to_proto(snippet)
