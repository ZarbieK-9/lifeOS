"""SleepService gRPC implementation."""

from datetime import datetime, timezone
from sqlalchemy import select

from app.db import async_session
from app.models import SleepSessionModel
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc


def _session_to_proto(s: SleepSessionModel) -> lifeos_pb2.SleepSession:
    return lifeos_pb2.SleepSession(
        session_id=s.session_id,
        user_id=s.user_id,
        sleep_start=s.sleep_start or "",
        sleep_end=s.sleep_end or "",
        duration_minutes=s.duration_minutes or 0,
    )


class SleepServicer(lifeos_pb2_grpc.SleepServiceServicer):
    async def List(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(SleepSessionModel)
                .where(SleepSessionModel.user_id == user_id)
                .order_by(SleepSessionModel.sleep_start.desc())
                .limit(30)
            )
            sessions = result.scalars().all()
            return lifeos_pb2.ListSleepResponse(
                sessions=[_session_to_proto(s) for s in sessions]
            )

    async def Record(self, request, context):
        user_id = context.user_id
        session_id = request.session_id or generate_id()

        async with async_session() as session:
            sleep = SleepSessionModel(
                session_id=session_id,
                user_id=user_id,
                sleep_start=request.sleep_start,
                sleep_end=request.sleep_end or None,
                duration_minutes=request.duration_minutes,
            )
            session.add(sleep)
            await session.commit()
            await session.refresh(sleep)
            return _session_to_proto(sleep)
