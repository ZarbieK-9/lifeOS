"""HydrationService gRPC implementation."""

from datetime import datetime, timezone
from sqlalchemy import select

from app.db import async_session
from app.models import HydrationLog
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc


def _log_to_proto(h: HydrationLog) -> lifeos_pb2.HydrationLog:
    return lifeos_pb2.HydrationLog(
        log_id=h.log_id,
        user_id=h.user_id,
        amount_ml=h.amount_ml,
        timestamp=h.timestamp or "",
        synced=True,
    )


class HydrationServicer(lifeos_pb2_grpc.HydrationServiceServicer):
    async def List(self, request, context):
        user_id = context.user_id
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()

        async with async_session() as session:
            result = await session.execute(
                select(HydrationLog)
                .where(
                    HydrationLog.user_id == user_id,
                    HydrationLog.timestamp >= today_start,
                )
                .order_by(HydrationLog.timestamp.desc())
            )
            logs = result.scalars().all()
            return lifeos_pb2.ListHydrationResponse(
                logs=[_log_to_proto(h) for h in logs]
            )

    async def Log(self, request, context):
        user_id = context.user_id
        log_id = request.log_id or generate_id()

        async with async_session() as session:
            log = HydrationLog(
                log_id=log_id,
                user_id=user_id,
                amount_ml=request.amount_ml,
                timestamp=request.timestamp or datetime.now(timezone.utc).isoformat(),
                synced=True,
            )
            session.add(log)
            await session.commit()
            await session.refresh(log)
            return _log_to_proto(log)
