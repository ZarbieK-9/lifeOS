"""AutomationService gRPC implementation + cron scheduler."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from croniter import croniter
from sqlalchemy import select

from app.db import async_session
from app.models import AutomationRuleModel
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos.automation")


def _rule_to_proto(r: AutomationRuleModel) -> lifeos_pb2.AutomationRule:
    return lifeos_pb2.AutomationRule(
        id=r.id,
        user_id=r.user_id,
        name=r.name,
        description=r.description or "",
        rule_type=r.rule_type,
        schedule=r.schedule or "",
        condition=r.condition or "",
        actions=r.actions or "[]",
        enabled=r.enabled,
        last_triggered=str(r.last_triggered) if r.last_triggered else "",
        created_at=str(r.created_at) if r.created_at else "",
    )


class AutomationServicer(lifeos_pb2_grpc.AutomationServiceServicer):
    async def ListRules(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(AutomationRuleModel)
                .where(AutomationRuleModel.user_id == user_id)
                .order_by(AutomationRuleModel.created_at.desc())
            )
            rules = result.scalars().all()
            return lifeos_pb2.ListRulesResponse(
                rules=[_rule_to_proto(r) for r in rules]
            )

    async def CreateRule(self, request, context):
        user_id = context.user_id
        rule_id = generate_id()
        now = datetime.now(timezone.utc)

        async with async_session() as session:
            rule = AutomationRuleModel(
                id=rule_id,
                user_id=user_id,
                name=request.name,
                description=request.description,
                rule_type=request.rule_type,
                schedule=request.schedule or None,
                condition=request.condition or None,
                actions=request.actions,
                enabled=request.enabled,
                created_at=now,
            )
            session.add(rule)
            await session.commit()
            return _rule_to_proto(rule)

    async def UpdateRule(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(AutomationRuleModel)
                .where(AutomationRuleModel.id == request.id)
                .where(AutomationRuleModel.user_id == user_id)
            )
            rule = result.scalar_one_or_none()
            if not rule:
                import grpc
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details("Automation rule not found")
                return lifeos_pb2.AutomationRule()

            if request.name:
                rule.name = request.name
            if request.description:
                rule.description = request.description
            if request.schedule:
                rule.schedule = request.schedule
            if request.condition:
                rule.condition = request.condition
            if request.actions:
                rule.actions = request.actions
            rule.enabled = request.enabled
            await session.commit()
            return _rule_to_proto(rule)

    async def DeleteRule(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            result = await session.execute(
                select(AutomationRuleModel)
                .where(AutomationRuleModel.id == request.id)
                .where(AutomationRuleModel.user_id == user_id)
            )
            rule = result.scalar_one_or_none()
            if rule:
                await session.delete(rule)
                await session.commit()
            return lifeos_pb2.Empty()


# ── Cron scheduler — runs every 60s, evaluates schedule rules ──

async def automation_cron_loop():
    """Background task that evaluates automation rules every 60 seconds."""
    logger.info("Automation cron scheduler started")

    while True:
        try:
            await _evaluate_rules()
        except Exception as e:
            logger.error(f"Automation cron error: {e}")

        await asyncio.sleep(60)


async def _evaluate_rules():
    """Check all enabled schedule rules and trigger if cron matches."""
    now = datetime.now(timezone.utc)

    async with async_session() as session:
        result = await session.execute(
            select(AutomationRuleModel)
            .where(AutomationRuleModel.enabled.is_(True))
            .where(AutomationRuleModel.rule_type == "schedule")
        )
        rules = result.scalars().all()

        for rule in rules:
            if not rule.schedule:
                continue

            try:
                cron = croniter(rule.schedule, now)
                prev_fire = cron.get_prev(datetime)
                # If the previous fire time is within the last 60s, trigger
                elapsed = (now - prev_fire).total_seconds()
                if elapsed < 60:
                    # Check we haven't already triggered in this window
                    if rule.last_triggered:
                        last = rule.last_triggered if isinstance(rule.last_triggered, datetime) else datetime.fromisoformat(str(rule.last_triggered))
                        if (now - last).total_seconds() < 60:
                            continue

                    logger.info(f"Triggering automation rule: {rule.name} (id={rule.id})")

                    actions = json.loads(rule.actions)
                    await _execute_actions(rule.user_id, actions)

                    rule.last_triggered = now
                    await session.commit()
            except Exception as e:
                logger.error(f"Error evaluating rule {rule.id}: {e}")


async def _execute_actions(user_id: str, actions: list):
    """Execute a list of automation actions server-side."""
    from app.services.ai_service import _dispatch_tool

    for action in actions:
        tool = action.get("tool", "")
        params = action.get("params", {})

        # Build a pseudo-command string for the tool dispatcher
        command = _build_command_string(tool, params)
        if command:
            try:
                output, status = await _dispatch_tool(user_id, command)
                logger.info(f"  Action {tool}: {output} [{status}]")
            except Exception as e:
                logger.error(f"  Action {tool} failed: {e}")


def _build_command_string(tool: str, params: dict) -> str:
    """Convert a tool + params into a natural language command for the dispatcher."""
    if tool == "log_hydration":
        ml = params.get("amount_ml", 250)
        return f"log {ml}ml water"
    elif tool == "add_task":
        title = params.get("title", "untitled")
        priority = params.get("priority", "")
        return f"add task {title}" + (f" {priority} priority" if priority else "")
    elif tool == "set_focus_mode":
        enabled = params.get("enabled", True)
        dur = params.get("durationMin", 45)
        return f"start focus {dur} minutes" if enabled else "stop focus"
    elif tool == "query_status":
        return "show status"
    elif tool == "query_tasks":
        return "show tasks"
    elif tool == "query_hydration":
        return "how much water"
    elif tool == "log_sleep":
        action = params.get("action", "log")
        return f"{action} sleep"
    elif tool == "query_sleep":
        period = params.get("period", "today")
        return f"show sleep {period}"
    elif tool == "schedule_reminder":
        text = params.get("text", "reminder")
        return f"remind me to {text}"
    return ""
