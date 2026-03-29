"""AiService gRPC implementation — offline-only; keyword dispatch for webhook/automation."""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import grpc
from app.db import async_session
from app.models import AiCommandModel
from app.auth import generate_id

from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos.ai")

# ── Offline-only stub message (chat runs on device) ───

OFFLINE_ONLY_MESSAGE = (
    "AI runs on your device only. Use the app to chat with PicoClaw."
)

# ── Keyword fallback (for webhook/automation) ─────────

HYDRATION_KW = ("water", "drink", "hydrat", "ml", "glass", "cup", "sip")
TASK_KW = ("task", "todo", "remind", "reminder", "errand", "chore")
FOCUS_KW = ("focus", "concentrate", "deep work", "pomodoro")
SLEEP_KW = ("sleep", "nap", "rest", "bed")
QUERY_KW = ("show", "list", "what", "how", "get", "view", "status", "summary")
COMPLETE_KW = ("done", "complete", "finish", "check off", "mark done")
DELETE_KW = ("delete", "remove", "cancel", "discard")
REMIND_PHRASE = ("remind me", "alert me", "notify me")
SETTINGS_KW = ("setting", "configure", "change goal", "adjust", "set goal", "set default")
AUTOMATION_KW = ("rule", "automate", "automation", "whenever", "create rule")
WEBHOOK_KW = ("webhook", "connect tasker", "setup integration", "api setup")
ENABLE_KW = ("start", "enable", "begin", "on", "activate", "turn on")
DISABLE_KW = ("stop", "disable", "end", "off", "deactivate", "turn off")

ALLOWED_TOOLS: dict[str, set[str]] = {
    "log_hydration": {"amount_ml"},
    "query_hydration": set(),
    "complete_task": {"title_match"},
    "delete_task": {"title_match"},
    "query_tasks": {"filter"},
    "add_task": {"title", "priority"},
    "set_focus_mode": {"enabled", "durationMin"},
    "query_sleep": {"period"},
    "log_sleep": {"action"},
    "schedule_reminder": {"text", "hour", "minute"},
    "update_setting": {"setting", "value"},
    "create_automation_rule": {"raw"},
    "show_webhook_info": set(),
    "query_status": set(),
}


def _matches(lower: str, keywords: tuple) -> bool:
    return any(kw in lower for kw in keywords)


def _keyword_dispatch(text: str) -> tuple[str, list[dict]]:
    """
    Keyword-based intent matching. Returns (output_text, tool_calls).
    Does NOT execute tools server-side; tools run on the device.
    """
    lower = text.lower()
    is_query = _matches(lower, QUERY_KW)

    if _matches(lower, HYDRATION_KW):
        if is_query:
            return "Checking hydration...", [{"tool": "query_hydration", "params": {}}]
        ml_match = re.search(r"(\d+)\s*ml\b", text, re.IGNORECASE)
        glass_match = re.search(r"(\d+)\s*glass(?:es)?\b", text, re.IGNORECASE)
        cup_match = re.search(r"(\d+)\s*cups?\b", text, re.IGNORECASE)
        liter_match = re.search(r"([\d.]+)\s*(?:liters?|l)\b", text, re.IGNORECASE)
        if ml_match:
            ml = int(ml_match.group(1))
        elif glass_match:
            ml = int(glass_match.group(1)) * 250
        elif cup_match:
            ml = int(cup_match.group(1)) * 250
        elif liter_match:
            ml = round(float(liter_match.group(1)) * 1000)
        else:
            ml = 250
        return f"Logging {ml}ml of water.", [
            {"tool": "log_hydration", "params": {"amount_ml": ml}}
        ]

    if _matches(lower, COMPLETE_KW):
        title = re.sub(
            r"^(mark\s+)?(done|complete|finish|check\s+off)\s+(with\s+)?",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()
        title = (
            re.sub(r"^(mark\s+)?task\s*", "", title, flags=re.IGNORECASE).strip()
            or text
        )
        return f'Completing task "{title}"...', [
            {"tool": "complete_task", "params": {"title_match": title}}
        ]

    if _matches(lower, DELETE_KW) and _matches(lower, TASK_KW):
        title = (
            re.sub(
                r"^(delete|remove|cancel)\s+(the\s+)?task\s*",
                "",
                text,
                flags=re.IGNORECASE,
            ).strip()
            or text
        )
        return f'Deleting task "{title}"...', [
            {"tool": "delete_task", "params": {"title_match": title}}
        ]

    if _matches(lower, TASK_KW) and is_query:
        return "Fetching tasks...", [
            {"tool": "query_tasks", "params": {"filter": "pending"}}
        ]

    if _matches(lower, TASK_KW):
        title = re.sub(
            r"^(add|create|new|make|set|remind(?:\s+me)?(?:\s+to)?)\s+(a\s+)?(?:task|todo|reminder)\s*",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()
        title = (
            re.sub(
                r"\s+(high|low|medium|normal)\s*(?:priority|prio)?\s*$",
                "",
                title,
                flags=re.IGNORECASE,
            ).strip()
            or text
        )
        priority = (
            "high"
            if re.search(r"\bhigh\s*(?:priority|prio)?\b", lower)
            else "low"
            if re.search(r"\blow\s*(?:priority|prio)?\b", lower)
            else "medium"
        )
        return f'Creating task "{title}"...', [
            {"tool": "add_task", "params": {"title": title, "priority": priority}}
        ]

    if _matches(lower, FOCUS_KW):
        dur_match = re.search(r"(\d+)\s*(?:min(?:ute)?s?|m)\b", text)
        dur = int(dur_match.group(1)) if dur_match else 45
        is_disable = any(kw in lower for kw in ("stop", "disable", "end", "off"))
        return (
            "Stopping focus mode." if is_disable else f"Starting focus mode for {dur} minutes."
        ), [{"tool": "set_focus_mode", "params": {"enabled": not is_disable, "durationMin": dur}}]

    if _matches(lower, SLEEP_KW):
        if is_query:
            period = "week" if "week" in lower else "today"
            return "Checking sleep data...", [
                {"tool": "query_sleep", "params": {"period": period}}
            ]
        action = (
            "start"
            if _matches(lower, ENABLE_KW)
            else "stop"
            if _matches(lower, DISABLE_KW)
            else "log"
        )
        return "Updating sleep tracking...", [
            {"tool": "log_sleep", "params": {"action": action}}
        ]

    if _matches(lower, REMIND_PHRASE):
        m = re.search(
            r"remind\s+me\s+to\s+(.+?)(?:\s+(?:at|on|in)\s+|$)",
            text,
            re.IGNORECASE,
        )
        reminder_text = m.group(1).strip() if m else text
        return f'Setting reminder: "{reminder_text}"', [
            {"tool": "schedule_reminder", "params": {"text": reminder_text}}
        ]

    if _matches(lower, SETTINGS_KW):
        return "Updating settings...", [
            {"tool": "update_setting", "params": {"setting": "unknown", "value": 0}}
        ]

    if _matches(lower, AUTOMATION_KW):
        return "Creating automation rule...", [
            {"tool": "create_automation_rule", "params": {"raw": text}}
        ]

    if _matches(lower, WEBHOOK_KW):
        return "Showing webhook info...", [
            {"tool": "show_webhook_info", "params": {}}
        ]

    if is_query:
        return "Checking status...", [{"tool": "query_status", "params": {}}]

    return f'Understood: "{text}". I couldn\'t match a specific command.', []


def _validate_tool_call(tool_call: dict[str, Any]) -> str | None:
    tool = str(tool_call.get("tool") or "").strip()
    params = tool_call.get("params")
    if not tool:
        return "missing tool name"
    if tool not in ALLOWED_TOOLS:
        return f"unsupported tool '{tool}'"
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return "params must be an object"
    extra = set(params.keys()) - ALLOWED_TOOLS[tool]
    if extra:
        return f"unexpected params for {tool}: {sorted(extra)}"
    required = {
        "log_hydration": {"amount_ml"},
        "complete_task": {"title_match"},
        "delete_task": {"title_match"},
        "add_task": {"title"},
        "set_focus_mode": {"enabled"},
        "log_sleep": {"action"},
        "schedule_reminder": {"text"},
        "update_setting": {"setting", "value"},
        "create_automation_rule": {"raw"},
    }.get(tool, set())
    for field in required:
        if field not in params:
            return f"missing required param '{field}' for {tool}"
    return None


async def _dispatch_tool(user_id: str, text: str) -> tuple[str, str]:
    """
    Run keyword dispatch and return (output_message, status).
    Used by webhook and automation services. Optionally persists to AiCommandModel.
    """
    output, tool_calls = _keyword_dispatch(text)
    if not tool_calls:
        status = "no_intent"
    else:
        for call in tool_calls:
            err = _validate_tool_call(call)
            if err:
                return f"Command rejected: {err}", "invalid_intent"
        status = "planned"
    logger.info(
        "dispatch_tool user=%s status=%s intents=%s",
        user_id[:8] if user_id else "unknown",
        status,
        json.dumps(tool_calls),
    )
    try:
        async with async_session() as session:
            cmd = AiCommandModel(
                id=generate_id(),
                user_id=user_id,
                input=text,
                output=output,
                status=status,
                created_at=datetime.now(timezone.utc),
            )
            session.add(cmd)
            await session.commit()
    except Exception as e:
        logger.warning("Failed to persist ai command: %s", e)
    return output, status


# ── Proto helper ──────────────────────────────────────


def _cmd_to_proto(c: AiCommandModel) -> lifeos_pb2.AiCommand:
    return lifeos_pb2.AiCommand(
        id=c.id,
        user_id=c.user_id,
        input=c.input or "",
        output=c.output or "",
        status=c.status or "pending",
        created_at=str(c.created_at) if c.created_at else "",
    )


# ── gRPC Servicer ─────────────────────────────────────


class AiServicer(lifeos_pb2_grpc.AiServiceServicer):
    """AI service: offline-only; Submit/AgentTurn return stub. History and Transcribe unchanged."""

    async def Submit(self, request, context):
        return lifeos_pb2.SubmitAiResponse(
            id=request.id or generate_id(),
            output=OFFLINE_ONLY_MESSAGE,
            status="offline_only",
            intents=[],
        )

    async def AgentTurn(self, request, context):
        return lifeos_pb2.AgentTurnResponse(
            session_id=request.session_id or "",
            output=OFFLINE_ONLY_MESSAGE,
            intents=[],
            done=True,
            turn=0,
            status="offline_only",
        )

    async def History(self, request, context):
        user_id = context.user_id
        async with async_session() as session:
            from sqlalchemy import select

            result = await session.execute(
                select(AiCommandModel)
                .where(AiCommandModel.user_id == user_id)
                .order_by(AiCommandModel.created_at.desc())
                .limit(50)
            )
            commands = result.scalars().all()
            return lifeos_pb2.AiHistoryResponse(
                commands=[_cmd_to_proto(c) for c in commands]
            )

    async def Transcribe(self, request, context):
        """Transcribe audio bytes to text using STT service."""
        audio_bytes = request.audio
        content_type = request.content_type or "audio/m4a"

        if not audio_bytes:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("No audio data provided")
            return lifeos_pb2.TranscribeResponse(text="")

        try:
            from app.services.transcription_service import transcribe_audio
            text = await transcribe_audio(audio_bytes, content_type)
            return lifeos_pb2.TranscribeResponse(text=text)
        except RuntimeError as e:
            logger.error("Transcription failed: %s", e)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return lifeos_pb2.TranscribeResponse(text="")
