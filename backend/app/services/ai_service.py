"""AiService gRPC implementation — Gemini-powered PicoClaw with keyword fallback."""

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.db import async_session
from app.models import AiCommandModel
from app.auth import generate_id

import grpc
from gen import lifeos_pb2, lifeos_pb2_grpc

logger = logging.getLogger("lifeos.ai")

# ── Gemini client (lazy init) ───────────────────────────

_genai_client = None


def _get_genai_client():
    """Lazy-initialize the google.genai Client."""
    global _genai_client
    if _genai_client is not None:
        return _genai_client

    if not settings.GEMINI_API_KEY:
        return None

    from google import genai

    _genai_client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _genai_client


# ── Agentic session store ────────────────────────────

MAX_AGENT_TURNS = 5
SESSION_TTL_SEC = 300  # 5 minutes


class AgentSession:
    """Holds Gemini conversation state for an agentic loop."""
    __slots__ = ("contents", "turn", "created_at", "last_accessed", "cmd_id", "user_id", "original_input")

    def __init__(self, cmd_id: str, user_id: str, original_input: str = ""):
        self.contents: list = []
        self.turn: int = 0
        self.created_at: float = time.monotonic()
        self.last_accessed: float = time.monotonic()
        self.cmd_id = cmd_id
        self.user_id = user_id
        self.original_input = original_input


_agent_sessions: dict[str, AgentSession] = {}


def _get_agent_session(session_id: str) -> AgentSession | None:
    session = _agent_sessions.get(session_id)
    if session is None:
        return None
    if time.monotonic() - session.last_accessed > SESSION_TTL_SEC:
        del _agent_sessions[session_id]
        return None
    session.last_accessed = time.monotonic()
    return session


def _create_agent_session(cmd_id: str, user_id: str, original_input: str = "") -> tuple[str, AgentSession]:
    # Lazy cleanup of expired sessions
    now = time.monotonic()
    stale = [k for k, v in _agent_sessions.items() if now - v.last_accessed > SESSION_TTL_SEC]
    for k in stale:
        del _agent_sessions[k]

    session_id = uuid.uuid4().hex[:16]
    session = AgentSession(cmd_id, user_id, original_input)
    _agent_sessions[session_id] = session
    return session_id, session


def _remove_agent_session(session_id: str) -> None:
    _agent_sessions.pop(session_id, None)


# ── System prompt ─────────────────────────────────────

SYSTEM_PROMPT = """\
You are PicoClaw, a personal life assistant inside the LifeOS mobile app.
You're like a helpful, friendly buddy — not a corporate bot. Keep it casual, warm, \
and encouraging. Use short sentences. Throw in the occasional light humor.

You help the user manage tasks, track hydration, control focus mode, manage sleep,
handle calendar events, triage emails, set reminders, and more.

You have access to the user's current state (context) with each message: their calendar, \
emails, tasks, hydration, sleep, focus mode, and any memories from past conversations.

## Core Rules

- When the user asks you to DO something (log water, add task, etc.), call the \
appropriate function. You may call multiple functions in one response.
- When the user asks a QUESTION or wants info, call the appropriate query function.
- For conversational messages, respond naturally. Reference their context in your response.
- When asked to "organize my day" or "plan my day", reference their actual calendar events \
and tasks to build a real plan. Create tasks or events as needed.
- Be concise — 1-3 sentences for simple actions. Longer for briefings/reflections.
- Make reasonable assumptions rather than asking for clarification \
(e.g., "log water" → 250ml, "add task" with no priority → medium).
- For compound requests, call all relevant functions.

## Multi-Turn Tool Use

You operate in a multi-turn agentic loop. When you call functions:
1. Your function calls will be executed, and the results will be sent back to you.
2. You can then call MORE functions based on what you learned, or provide your FINAL response.

When providing your final response (no more function calls):
- Synthesize information from tool results into a natural, helpful response.
- Don't just parrot back raw data — interpret it, prioritize, and add your personality.
- For "plan my day" requests: after querying tasks and calendar, build a structured plan \
with times and priorities, creating any needed events.
- For status checks: summarize what matters most, not everything.

You have a maximum of 5 turns. Be efficient:
- Call multiple related functions in a single turn when possible.
- Don't call a function just to confirm something you already did — trust the result.

## Memory

If the user mentions a preference, commitment, or important fact you should remember, \
include a [REMEMBER: fact] tag in your response. Examples:
- User says "I'm trying to drink 3L a day" → include [REMEMBER: User's hydration goal is 3000ml per day]
- User says "I'll call the dentist tomorrow" → include [REMEMBER: User plans to call the dentist tomorrow]
- User says "I prefer morning workouts" → include [REMEMBER: User prefers morning workouts]

The [REMEMBER: ...] tags will be parsed out and stored. They won't be shown to the user, \
so your visible response should still be natural. You can include multiple tags.

The memory section in context shows facts from past conversations — reference them naturally \
when relevant (e.g., "You mentioned wanting to call the dentist — did you get to that?").

## Proactive Messages

Sometimes the input will start with a [SYSTEM: ...] tag. These are automated prompts, \
not from the user typing. Handle them as follows:

**[SYSTEM: MORNING BRIEFING]** — Generate a cheerful morning overview:
  - Greet them ("Good morning!" or similar)
  - Today's calendar events (meetings, appointments)
  - Pending tasks, especially high-priority or overdue ones
  - Any pending email action items
  - Weather or hydration nudge
  - Keep it scannable with short bullet points

**[SYSTEM: CHECK-IN]** — A brief midday/afternoon nudge:
  - Pick ONE or TWO relevant things: hydration progress, upcoming meeting in 30min, \
    a task they could knock out, or just encouragement
  - Keep it to 1-2 sentences. Don't overwhelm.
  - Skip if there's nothing meaningful to say (just say something encouraging)

**[SYSTEM: EVENING REFLECTION]** — End-of-day wrap-up:
  - What they accomplished today (completed tasks, meetings attended)
  - What carries over to tomorrow
  - Tomorrow preview (calendar events)
  - Encouraging sign-off ("Get some rest!" or similar)

**[SYSTEM: CALENDAR ALERT]** — An upcoming event needs attention:
  - The alert tells you which event and how many minutes until it starts
  - Give a brief, friendly heads-up ("Heads up — your meeting starts in 10 min!")
  - If there are related pending tasks, mention them
  - If the event has a location, mention it
  - Keep it to 2-3 sentences max. This is a quick nudge, not a briefing.

**[SYSTEM: NEW EMAILS]** — New emails just arrived:
  - The alert tells you how many and from whom
  - Briefly summarize what came in (1 line per email max)
  - Highlight anything that looks urgent or needs a reply
  - If an email contains an action item, you may call add_task to create it
  - Keep it short — the user can check their inbox for details

**[SYSTEM: APP NOTIFICATION]** — A notification from another app (Instagram, WhatsApp, etc.):
  - The alert tells you which app, who sent it, and the message text
  - Briefly tell the user what they received ("You got a message from @john on Instagram")
  - If it's a message/DM, suggest a natural reply they could copy and send back
  - If it's not a message (app update, promo, etc.), just acknowledge briefly or skip
  - If the notification implies an action item, you may call add_task
  - Keep it to 2-3 sentences + suggested reply if applicable

For all proactive messages, feel free to reference memories for personalization.

## Conversation Context

You may receive a [Recent conversation] section showing the last few exchanges between \
you and the user. Use this to maintain coherence:
- Reference what was just discussed. Handle follow-ups naturally.
- If the user says something vague like "do that", "yes", "make it urgent", or "the one I mentioned", \
  look at the conversation history to infer what they mean.
- Avoid repeating yourself. If you just gave a briefing, don't re-summarize.
- If the user corrects you, acknowledge and adjust.
"""

# ── Tool declarations for Gemini function calling ──────

TOOL_DECLARATIONS = {
    "function_declarations": [
        {
            "name": "add_task",
            "description": "Create a new task (optionally recurring)",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING", "description": "Task title"},
                    "priority": {"type": "STRING", "description": "low, medium, or high"},
                    "dueDate": {"type": "STRING", "description": "Due date string"},
                    "notes": {"type": "STRING", "description": "Additional notes"},
                    "recurrence": {
                        "type": "STRING",
                        "description": "Recurrence pattern (e.g. 'every Monday', 'daily')",
                    },
                },
                "required": ["title"],
            },
        },
        {
            "name": "complete_task",
            "description": "Mark a task as completed by fuzzy title match",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "title_match": {
                        "type": "STRING",
                        "description": "Text to match against task titles",
                    },
                },
                "required": ["title_match"],
            },
        },
        {
            "name": "delete_task",
            "description": "Delete a task by fuzzy title match",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "title_match": {
                        "type": "STRING",
                        "description": "Text to match against task titles",
                    },
                },
                "required": ["title_match"],
            },
        },
        {
            "name": "log_hydration",
            "description": "Log water intake in milliliters",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "amount_ml": {
                        "type": "NUMBER",
                        "description": "Amount in milliliters",
                    },
                },
                "required": ["amount_ml"],
            },
        },
        {
            "name": "set_focus_mode",
            "description": "Toggle focus mode on or off",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "enabled": {
                        "type": "BOOLEAN",
                        "description": "Enable or disable focus mode",
                    },
                    "durationMin": {
                        "type": "NUMBER",
                        "description": "Duration in minutes (default 45)",
                    },
                },
                "required": ["enabled"],
            },
        },
        {
            "name": "send_snippet",
            "description": "Send a message snippet to a partner",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "content": {"type": "STRING", "description": "Message content"},
                    "partnerId": {
                        "type": "STRING",
                        "description": "Partner ID (defaults to first partner)",
                    },
                },
                "required": ["content"],
            },
        },
        {
            "name": "query_status",
            "description": "Get an overview of current status (tasks, hydration, focus, sleep)",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "query_tasks",
            "description": "List tasks with optional filter",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "filter": {
                        "type": "STRING",
                        "description": "Filter: pending, completed, overdue, or all",
                    },
                },
            },
        },
        {
            "name": "query_hydration",
            "description": "Show today's hydration progress",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "query_calendar",
            "description": "Show upcoming calendar events",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "range": {
                        "type": "STRING",
                        "description": "today, tomorrow, or week",
                    },
                },
            },
        },
        {
            "name": "create_event",
            "description": "Create a Google Calendar event",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "summary": {"type": "STRING", "description": "Event title"},
                    "hour": {"type": "NUMBER", "description": "Start hour (24h)"},
                    "minute": {"type": "NUMBER", "description": "Start minute"},
                    "tomorrow": {
                        "type": "BOOLEAN",
                        "description": "Schedule for tomorrow",
                    },
                },
                "required": ["summary"],
            },
        },
        {
            "name": "query_emails",
            "description": "Show emails from inbox with optional category filter",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "filter": {
                        "type": "STRING",
                        "description": "unread, important, action_needed, or newsletter",
                    },
                },
            },
        },
        {
            "name": "triage_emails",
            "description": "Categorize inbox emails into important/action_needed/fyi/newsletter",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "extract_tasks_from_email",
            "description": "Extract action items from emails and create tasks",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "set_hydration_reminder",
            "description": "Set up hydration reminders with a time range and daily goal",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "startHour": {
                        "type": "NUMBER",
                        "description": "Start hour (0-23)",
                    },
                    "endHour": {
                        "type": "NUMBER",
                        "description": "End hour (0-23)",
                    },
                    "goalMl": {
                        "type": "NUMBER",
                        "description": "Daily water goal in ml",
                    },
                },
                "required": ["startHour", "endHour", "goalMl"],
            },
        },
        {
            "name": "disable_hydration_reminder",
            "description": "Turn off hydration reminders",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "create_api_key",
            "description": "Generate a new API key for external integrations (Tasker, webhooks)",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "name": {
                        "type": "STRING",
                        "description": "Label for the key (e.g. 'Tasker')",
                    },
                },
                "required": ["name"],
            },
        },
        {
            "name": "list_api_keys",
            "description": "Show all API keys for external integrations",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
        {
            "name": "revoke_api_key",
            "description": "Revoke an API key by name",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "name_match": {
                        "type": "STRING",
                        "description": "Name of the key to revoke",
                    },
                },
                "required": ["name_match"],
            },
        },
        {
            "name": "log_sleep",
            "description": "Start/stop sleep tracking or log a sleep session",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "description": "start, stop, or log",
                    },
                    "time": {
                        "type": "STRING",
                        "description": "Time string (e.g. '11pm')",
                    },
                },
                "required": ["action"],
            },
        },
        {
            "name": "query_sleep",
            "description": "Show sleep stats for today or this week",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "period": {
                        "type": "STRING",
                        "description": "today or week",
                    },
                },
            },
        },
        {
            "name": "update_setting",
            "description": "Change a setting like hydration goal or focus duration",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "setting": {
                        "type": "STRING",
                        "description": "Setting key: hydration_goal or focus_duration",
                    },
                    "value": {"type": "NUMBER", "description": "New value"},
                },
                "required": ["setting", "value"],
            },
        },
        {
            "name": "schedule_reminder",
            "description": "Schedule a push notification reminder",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "text": {"type": "STRING", "description": "Reminder text"},
                    "hour": {"type": "NUMBER", "description": "Hour (24h)"},
                    "minute": {"type": "NUMBER", "description": "Minute"},
                },
                "required": ["text"],
            },
        },
        {
            "name": "create_automation_rule",
            "description": "Create an automation rule from natural language (e.g. 'every weekday at 9am add task standup')",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "raw": {
                        "type": "STRING",
                        "description": "Raw user input describing the rule",
                    },
                },
                "required": ["raw"],
            },
        },
        {
            "name": "show_webhook_info",
            "description": "Show instructions for connecting Tasker or other webhook tools",
            "parameters": {"type": "OBJECT", "properties": {}},
        },
    ]
}


# ── Gemini caller ─────────────────────────────────────


async def _call_gemini(text: str, context_json: str = "") -> tuple[str, list[dict]]:
    """
    Call Gemini with user text and optional app context.

    Returns (ai_message, tool_calls).
    - ai_message: The model's natural language response text.
    - tool_calls: List of {"tool": name, "params": {}} dicts for frontend execution.

    Raises Exception on API failure so caller can fall back.
    """
    client = _get_genai_client()
    if client is None:
        raise RuntimeError("Gemini not configured")

    from google.genai import types

    # Build the user message with datetime and optional context
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = [f"[Current time: {now_str}]"]

    if context_json:
        try:
            import json as _json
            ctx = _json.loads(context_json)
            # Extract conversation history before including raw context
            conversation_history = ctx.pop("conversation_history", [])
            parts.append(f"\n[User's current state]\n{_json.dumps(ctx)}")

            # Include conversation history as multi-turn context
            if conversation_history:
                history_lines = ["\n[Recent conversation]"]
                for exchange in conversation_history[-6:]:
                    role = exchange.get("role", "user")
                    inp = exchange.get("input", "")
                    out = exchange.get("output", "")
                    history_lines.append(f"{'User' if role == 'user' else 'System'}: {inp}")
                    history_lines.append(f"PicoClaw: {out}")
                parts.append("\n".join(history_lines))
        except (ValueError, TypeError):
            parts.append(f"\n[User's current state]\n{context_json}")

    parts.append(f"\nUser: {text}")
    user_content = "\n".join(parts)

    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[TOOL_DECLARATIONS],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )

    ai_message = ""
    tool_calls = []

    if response.candidates:
        for part in response.candidates[0].content.parts:
            if part.text:
                ai_message += part.text
            if part.function_call:
                fc = part.function_call
                params = dict(fc.args) if fc.args else {}
                tool_calls.append({"tool": fc.name, "params": params})

    return ai_message.strip(), tool_calls


async def _call_gemini_multiturn(contents: list) -> tuple[str, list[dict]]:
    """
    Call Gemini with a full multi-turn content list.

    Returns (ai_message, tool_calls) — same shape as _call_gemini.
    The `contents` list includes all prior turns (user, model, tool roles).
    """
    client = _get_genai_client()
    if client is None:
        raise RuntimeError("Gemini not configured")

    from google.genai import types

    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[TOOL_DECLARATIONS],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )

    ai_message = ""
    tool_calls = []

    if response.candidates:
        for part in response.candidates[0].content.parts:
            if part.text:
                ai_message += part.text
            if part.function_call:
                fc = part.function_call
                params = dict(fc.args) if fc.args else {}
                tool_calls.append({"tool": fc.name, "params": params})

    return ai_message.strip(), tool_calls


# ── Keyword fallback (preserved from original) ───────

HYDRATION_KW = ("water", "drink", "hydrat", "ml", "glass", "cup", "sip")
TASK_KW = ("task", "todo", "remind", "reminder", "errand", "chore")
FOCUS_KW = ("focus", "concentrate", "deep work", "pomodoro")
SLEEP_KW = ("sleep", "nap", "rest", "bed")
QUERY_KW = ("show", "list", "what", "how", "get", "view", "status", "summary")
COMPLETE_KW = ("done", "complete", "finish", "check off", "mark done")
DELETE_KW = ("delete", "remove", "cancel", "discard")
LOG_KW = ("log", "record", "logged", "track", "tracking")
REMIND_PHRASE = ("remind me", "alert me", "notify me")
SETTINGS_KW = ("setting", "configure", "change goal", "adjust", "set goal", "set default")
AUTOMATION_KW = ("rule", "automate", "automation", "whenever", "create rule")
WEBHOOK_KW = ("webhook", "connect tasker", "setup integration", "api setup")
ENABLE_KW = ("start", "enable", "begin", "on", "activate", "turn on")
DISABLE_KW = ("stop", "disable", "end", "off", "deactivate", "turn off")


def _matches(lower: str, keywords: tuple) -> bool:
    return any(kw in lower for kw in keywords)


def _keyword_dispatch(text: str) -> tuple[str, list[dict]]:
    """
    Keyword-based intent matching fallback.
    Returns (output_text, tool_calls) — does NOT execute tools server-side.
    """
    lower = text.lower()
    is_query = _matches(lower, QUERY_KW)

    # Hydration
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

    # Task: complete
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

    # Task: delete
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

    # Task: query
    if _matches(lower, TASK_KW) and is_query:
        return "Fetching tasks...", [
            {"tool": "query_tasks", "params": {"filter": "pending"}}
        ]

    # Task: add
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

    # Focus
    if _matches(lower, FOCUS_KW):
        dur_match = re.search(r"(\d+)\s*(?:min(?:ute)?s?|m)\b", text)
        dur = int(dur_match.group(1)) if dur_match else 45
        is_disable = any(kw in lower for kw in ("stop", "disable", "end", "off"))
        return (
            "Stopping focus mode." if is_disable else f"Starting focus mode for {dur} minutes."
        ), [{"tool": "set_focus_mode", "params": {"enabled": not is_disable, "durationMin": dur}}]

    # Sleep
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

    # Reminder
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

    # Settings
    if _matches(lower, SETTINGS_KW):
        return "Updating settings...", [
            {"tool": "update_setting", "params": {"setting": "unknown", "value": 0}}
        ]

    # Automation
    if _matches(lower, AUTOMATION_KW):
        return "Creating automation rule...", [
            {"tool": "create_automation_rule", "params": {"raw": text}}
        ]

    # Webhook info
    if _matches(lower, WEBHOOK_KW):
        return "Showing webhook info...", [
            {"tool": "show_webhook_info", "params": {}}
        ]

    # General status query
    if is_query:
        return "Checking status...", [{"tool": "query_status", "params": {}}]

    # No match
    return f'Understood: "{text}". I couldn\'t match a specific command.', []


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
    async def Submit(self, request, context):
        user_id = context.user_id
        cmd_id = request.id or generate_id()
        now = datetime.now(timezone.utc)
        text = request.input
        context_json = request.context_json or ""

        ai_message = ""
        tool_calls = []
        status = "executed"

        # Try Gemini first
        try:
            ai_message, tool_calls = await _call_gemini(text, context_json)
            status = "gemini"
            logger.info(
                "Gemini returned %d tool call(s) for: %s", len(tool_calls), text[:80]
            )
        except Exception as e:
            logger.warning("Gemini failed, falling back to keywords: %s", e)
            ai_message, tool_calls = _keyword_dispatch(text)
            status = "fallback"

        # Build output text
        output = ai_message if ai_message else (
            "Done." if tool_calls else f'Understood: "{text}"'
        )

        # Persist to DB
        async with async_session() as session:
            cmd = AiCommandModel(
                id=cmd_id,
                user_id=user_id,
                input=text,
                output=output,
                status=status,
                created_at=now,
            )
            session.add(cmd)
            await session.commit()

        # Build proto response with intents
        proto_intents = [
            lifeos_pb2.ToolIntent(
                tool=tc["tool"],
                params_json=json.dumps(tc["params"]),
            )
            for tc in tool_calls
        ]

        return lifeos_pb2.SubmitAiResponse(
            id=cmd_id,
            output=output,
            status=status,
            intents=proto_intents,
        )

    async def AgentTurn(self, request, context):
        """
        Agentic multi-turn loop endpoint.

        First turn:  input + context_json provided, tool_results empty.
        Continuation: session_id + tool_results provided.
        """
        from google.genai import types

        user_id = context.user_id
        session_id = request.session_id or ""

        # ── First turn ──
        if not session_id:
            cmd_id = generate_id()
            session_id, agent_sess = _create_agent_session(cmd_id, user_id, request.input)

            text = request.input
            context_json = request.context_json or ""

            # Build initial user message (same format as _call_gemini)
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            parts_text = [f"[Current time: {now_str}]"]

            if context_json:
                try:
                    ctx = json.loads(context_json)
                    conversation_history = ctx.pop("conversation_history", [])
                    parts_text.append(f"\n[User's current state]\n{json.dumps(ctx)}")

                    if conversation_history:
                        history_lines = ["\n[Recent conversation]"]
                        for exchange in conversation_history[-6:]:
                            role = exchange.get("role", "user")
                            inp = exchange.get("input", "")
                            out = exchange.get("output", "")
                            history_lines.append(f"{'User' if role == 'user' else 'System'}: {inp}")
                            history_lines.append(f"PicoClaw: {out}")
                        parts_text.append("\n".join(history_lines))
                except (ValueError, TypeError):
                    parts_text.append(f"\n[User's current state]\n{context_json}")

            parts_text.append(f"\nUser: {text}")
            user_content = "\n".join(parts_text)

            agent_sess.contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=user_content)],
                )
            )

        # ── Continuation turn ──
        else:
            agent_sess = _get_agent_session(session_id)
            if agent_sess is None:
                return lifeos_pb2.AgentTurnResponse(
                    session_id=session_id,
                    output="Session expired. Please try again.",
                    done=True,
                    turn=0,
                    status="error",
                )

            if agent_sess.user_id != user_id:
                context.set_code(grpc.StatusCode.PERMISSION_DENIED)
                context.set_details("Session belongs to a different user")
                return lifeos_pb2.AgentTurnResponse(
                    session_id=session_id,
                    output="Session error.",
                    done=True,
                    turn=0,
                    status="error",
                )

            # Convert tool results into function response Content
            if request.tool_results:
                tool_response_parts = []
                for tr in request.tool_results:
                    response_data = {"success": tr.success, "message": tr.message}
                    if tr.data_json:
                        try:
                            response_data["data"] = json.loads(tr.data_json)
                        except (ValueError, TypeError):
                            response_data["data"] = tr.data_json

                    tool_response_parts.append(
                        types.Part.from_function_response(
                            name=tr.tool,
                            response=response_data,
                        )
                    )

                agent_sess.contents.append(
                    types.Content(role="user", parts=tool_response_parts)
                )

        # ── Call Gemini with accumulated conversation ──
        agent_sess.turn += 1

        try:
            ai_message, tool_calls = await _call_gemini_multiturn(agent_sess.contents)
            status = "gemini"
            logger.info(
                "AgentTurn %d: %d tool call(s), msg=%s",
                agent_sess.turn, len(tool_calls), ai_message[:80] if ai_message else "(none)",
            )
        except Exception as e:
            logger.warning("Gemini failed in agentic turn %d: %s", agent_sess.turn, e)
            _remove_agent_session(session_id)
            return lifeos_pb2.AgentTurnResponse(
                session_id=session_id,
                output=f"AI error: {e}",
                done=True,
                turn=agent_sess.turn,
                status="error",
            )

        # Store Gemini's response in session history
        model_parts = []
        if ai_message:
            model_parts.append(types.Part.from_text(text=ai_message))
        for tc in tool_calls:
            model_parts.append(
                types.Part.from_function_call(
                    name=tc["tool"],
                    args=tc["params"],
                )
            )
        if model_parts:
            agent_sess.contents.append(
                types.Content(role="model", parts=model_parts)
            )

        # Decide: more tools or done?
        is_done = len(tool_calls) == 0 or agent_sess.turn >= MAX_AGENT_TURNS

        if is_done and tool_calls:
            # Hit max turns but Gemini still wants tools — force done
            ai_message = ai_message or "I've completed the available actions."
            tool_calls = []

        # If done, persist to DB and clean up session
        if is_done:
            output = ai_message or "Done."
            async with async_session() as db_sess:
                cmd = AiCommandModel(
                    id=agent_sess.cmd_id,
                    user_id=user_id,
                    input=agent_sess.original_input,
                    output=output,
                    status=status,
                    created_at=datetime.now(timezone.utc),
                )
                db_sess.add(cmd)
                await db_sess.commit()
            _remove_agent_session(session_id)

        # Build proto response
        proto_intents = [
            lifeos_pb2.ToolIntent(
                tool=tc["tool"],
                params_json=json.dumps(tc["params"]),
            )
            for tc in tool_calls
        ]

        return lifeos_pb2.AgentTurnResponse(
            session_id=session_id,
            output=ai_message or "",
            intents=proto_intents,
            done=is_done,
            turn=agent_sess.turn,
            status=status,
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
