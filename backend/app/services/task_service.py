"""TaskService gRPC implementation."""

import grpc
from datetime import datetime, timezone
from sqlalchemy import select, delete, update

from app.db import async_session
from app.models import Task
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc


def _task_to_proto(t: Task) -> lifeos_pb2.Task:
    return lifeos_pb2.Task(
        task_id=t.task_id,
        user_id=t.user_id,
        title=t.title,
        due_date=t.due_date or "",
        priority=t.priority or "medium",
        notes=t.notes or "",
        status=t.status or "pending",
        created_at=str(t.created_at) if t.created_at else "",
        updated_at=str(t.updated_at) if t.updated_at else "",
    )


class TaskServicer(lifeos_pb2_grpc.TaskServiceServicer):
    async def List(self, request, context):
        user_id = context.user_id  # Set by auth interceptor
        async with async_session() as session:
            result = await session.execute(
                select(Task)
                .where(Task.user_id == user_id)
                .order_by(Task.created_at.desc())
            )
            tasks = result.scalars().all()
            return lifeos_pb2.ListTasksResponse(
                tasks=[_task_to_proto(t) for t in tasks]
            )

    async def Create(self, request, context):
        user_id = context.user_id
        task_id = request.task_id or generate_id()
        now = datetime.now(timezone.utc)

        async with async_session() as session:
            task = Task(
                task_id=task_id,
                user_id=user_id,
                title=request.title,
                due_date=request.due_date or None,
                priority=request.priority or "medium",
                notes=request.notes or "",
                status=request.status or "pending",
                created_at=now,
                updated_at=now,
            )
            session.add(task)
            await session.commit()
            await session.refresh(task)
            return _task_to_proto(task)

    async def Update(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(Task).where(
                    Task.task_id == request.task_id, Task.user_id == user_id
                )
            )
            task = result.scalar_one_or_none()
            if not task:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details("Task not found")
                return lifeos_pb2.Task()

            if request.title:
                task.title = request.title
            if request.due_date:
                task.due_date = request.due_date
            if request.priority:
                task.priority = request.priority
            if request.notes:
                task.notes = request.notes
            if request.status:
                task.status = request.status
            task.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(task)
            return _task_to_proto(task)

    async def Delete(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                delete(Task).where(
                    Task.task_id == request.task_id, Task.user_id == user_id
                )
            )
            if result.rowcount == 0:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details("Task not found")
            await session.commit()
            return lifeos_pb2.Empty()
