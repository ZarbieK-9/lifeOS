"""CoachDataService — coaching commitments, expenses sync, coach notifications."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import grpc
from sqlalchemy import select, update

from app.auth import generate_id
from app.db import async_session
from app.models import CoachCommitmentModel, CoachNotificationModel, ExpenseModel

from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos")


def _commitment_to_proto(c: CoachCommitmentModel) -> lifeos_pb2.CoachingCommitmentRecord:
    return lifeos_pb2.CoachingCommitmentRecord(
        id=c.id,
        suggestion=c.suggestion or "",
        reason=c.reason or "",
        date_suggested=c.date_suggested or "",
        date_due=c.date_due or "",
        adopted=bool(c.adopted),
        outcome=c.outcome or "",
        created_at=str(c.created_at) if c.created_at else "",
    )


def _notif_to_proto(n: CoachNotificationModel) -> lifeos_pb2.CoachNotification:
    return lifeos_pb2.CoachNotification(
        id=n.id,
        domain=n.domain or "productivity",
        title=n.title or "",
        body=n.body or "",
        priority=n.priority or "low",
        read=bool(n.read),
        rule_id=n.rule_id or "",
        created_at=str(n.created_at) if n.created_at else "",
    )


class CoachDataServicer(lifeos_pb2_grpc.CoachDataServiceServicer):
    async def UpsertCoachingCommitments(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.UpsertCoachingCommitmentsResponse(upserted=0)

        count = 0
        async with async_session() as session:
            for rec in request.commitments:
                cid = rec.id or generate_id()
                row = await session.get(CoachCommitmentModel, cid)
                if row:
                    if row.user_id != user_id:
                        continue
                    row.suggestion = rec.suggestion
                    row.reason = rec.reason or None
                    row.date_suggested = rec.date_suggested
                    row.date_due = rec.date_due or None
                    row.adopted = bool(rec.adopted)
                    row.outcome = rec.outcome or None
                else:
                    created_at = datetime.now(timezone.utc)
                    if rec.created_at:
                        try:
                            created_at = datetime.fromisoformat(
                                rec.created_at.replace("Z", "+00:00")
                            )
                        except ValueError:
                            pass
                    session.add(
                        CoachCommitmentModel(
                            id=cid,
                            user_id=user_id,
                            suggestion=rec.suggestion,
                            reason=rec.reason or None,
                            date_suggested=rec.date_suggested,
                            date_due=rec.date_due or None,
                            adopted=bool(rec.adopted),
                            outcome=rec.outcome or None,
                            created_at=created_at,
                        )
                    )
                count += 1
            await session.commit()

        return lifeos_pb2.UpsertCoachingCommitmentsResponse(upserted=count)

    async def UpsertExpenses(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.UpsertExpensesResponse(upserted=0)

        count = 0
        async with async_session() as session:
            for rec in request.expenses:
                eid = rec.id or generate_id()
                row = await session.get(ExpenseModel, eid)
                if row:
                    if row.user_id != user_id:
                        continue
                    row.amount = float(rec.amount)
                    row.currency = rec.currency or "USD"
                    row.category = rec.category or "other"
                    row.description = rec.description or None
                    row.date = rec.date
                    if rec.created_at:
                        row.created_at = rec.created_at
                else:
                    session.add(
                        ExpenseModel(
                            id=eid,
                            user_id=user_id,
                            amount=float(rec.amount),
                            currency=rec.currency or "USD",
                            category=rec.category or "other",
                            description=rec.description or None,
                            date=rec.date,
                            created_at=rec.created_at or None,
                        )
                    )
                count += 1
            await session.commit()

        return lifeos_pb2.UpsertExpensesResponse(upserted=count)

    async def ListCoachNotifications(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.ListCoachNotificationsResponse()

        limit = request.limit if request.limit > 0 else 50
        async with async_session() as session:
            q = select(CoachNotificationModel).where(
                CoachNotificationModel.user_id == user_id
            )
            if request.unread_only:
                q = q.where(CoachNotificationModel.read.is_(False))
            q = q.order_by(CoachNotificationModel.created_at.desc()).limit(limit)
            rows = (await session.execute(q)).scalars().all()

        return lifeos_pb2.ListCoachNotificationsResponse(
            notifications=[_notif_to_proto(n) for n in rows]
        )

    async def MarkCoachNotificationsRead(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.MarkCoachNotificationsReadResponse(updated=0)

        ids = list(request.ids)
        if not ids:
            return lifeos_pb2.MarkCoachNotificationsReadResponse(updated=0)

        async with async_session() as session:
            result = await session.execute(
                update(CoachNotificationModel)
                .where(
                    CoachNotificationModel.user_id == user_id,
                    CoachNotificationModel.id.in_(ids),
                )
                .values(read=True)
            )
            await session.commit()
            updated = result.rowcount or 0

        return lifeos_pb2.MarkCoachNotificationsReadResponse(updated=updated)

    async def MarkCoachNotificationsActed(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.MarkCoachNotificationsActedResponse(updated=0)

        ids = list(request.ids)
        if not ids:
            return lifeos_pb2.MarkCoachNotificationsActedResponse(updated=0)

        async with async_session() as session:
            result = await session.execute(
                update(CoachNotificationModel)
                .where(
                    CoachNotificationModel.user_id == user_id,
                    CoachNotificationModel.id.in_(ids),
                )
                .values(acted_on=1)
            )
            await session.commit()
            updated = result.rowcount or 0

        return lifeos_pb2.MarkCoachNotificationsActedResponse(updated=updated)

    async def ListCoachingCommitments(self, request, context):
        user_id = getattr(context, "user_id", None)
        if not user_id:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return lifeos_pb2.ListCoachingCommitmentsResponse()

        async with async_session() as session:
            rows = (
                await session.execute(
                    select(CoachCommitmentModel)
                    .where(CoachCommitmentModel.user_id == user_id)
                    .order_by(CoachCommitmentModel.created_at.desc())
                    .limit(100)
                )
            ).scalars().all()

        return lifeos_pb2.ListCoachingCommitmentsResponse(
            commitments=[_commitment_to_proto(c) for c in rows]
        )
