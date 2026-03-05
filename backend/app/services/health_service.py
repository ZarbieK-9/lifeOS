"""HealthService gRPC implementation."""

from sqlalchemy import text

from app.db import async_session
from app.services.partner_service import get_mqtt_client

from gen import lifeos_pb2, lifeos_pb2_grpc


class HealthServicer(lifeos_pb2_grpc.HealthServiceServicer):
    async def Check(self, request, context):
        # Check database
        db_status = "ok"
        try:
            async with async_session() as session:
                await session.execute(text("SELECT 1"))
        except Exception as e:
            db_status = f"error: {e}"

        # Check MQTT
        mqtt_status = "ok"
        mqtt = get_mqtt_client()
        if mqtt is None:
            mqtt_status = "disconnected"
        elif not mqtt.is_connected():
            mqtt_status = "disconnected"

        overall = "ok" if db_status == "ok" else "degraded"

        return lifeos_pb2.HealthResponse(
            status=overall,
            db=db_status,
            mqtt=mqtt_status,
        )
