"""
Server-side deterministic coach generation.

Ports deterministic logic from:
- frontend/src/agent/coaching.ts (Morning plan, Weekly review)
- frontend/src/agent/reflection.ts (Evening coach formatting + causal analysis)

No LLM usage.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.auth import generate_id
from app.db import async_session
from app.models import (
    Task,
    MoodLogModel,
    HydrationLog,
    SleepSessionModel,
    CalendarEventModel,
    BehaviorPatternModel,
    EmailCategoryModel,
    CoachCommitmentModel,
    DailyStreakModel,
)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    v = value.replace("Z", "+00:00") if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return None


def _now_utc(now: Optional[datetime] = None) -> datetime:
    if now is not None:
        return now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _coach_anchor_now(local_now: Optional[datetime]) -> datetime:
    """Anchor instant for coach windows; defaults to UTC if not provided."""
    if local_now is None:
        return datetime.now(timezone.utc)
    if local_now.tzinfo is None:
        return local_now.replace(tzinfo=timezone.utc)
    return local_now


def _local_date_str(dt: datetime, tz: Any) -> str:
    return dt.astimezone(tz).date().isoformat()


def _greeting_for_hour(hour: int) -> str:
    if hour < 12:
        return "Good morning! Here's your day."
    if hour < 17:
        return "Good afternoon - here's what's ahead."
    return "Good evening - quick plan check."


def _back_to_back_risk(timed_events: list[CalendarEventModel]) -> list[str]:
    """
    Port of coaching.ts backToBackRisk().
    """
    risks: list[str] = []
    # Assumes timed_events is already sorted by start_time asc.
    for i in range(0, len(timed_events) - 1):
        a = timed_events[i]
        b = timed_events[i + 1]
        a_end = _parse_dt(a.end_time)
        b_start = _parse_dt(b.start_time)
        if not a_end or not b_start:
            continue
        gap_min = int((b_start - a_end).total_seconds() / 60)
        if gap_min >= 0 and gap_min < 10:
            risks.append(
                f"Back-to-back: {a.summary} -> {b.summary} - hydrate or stretch between them."
            )
            break
    return risks


def _build_coach_note(patterns_by_description: dict[str, dict[str, Any]], hour: int) -> str:
    # task_completion_time exists in TS but may not be present on-device; port same behavior.
    prod_before_noon = patterns_by_description.get("task_completion_time")
    if prod_before_noon and hour < 12:
        ratio = (prod_before_noon.get("morningRatio") if isinstance(prod_before_noon, dict) else None)
        if ratio is not None and ratio > 0.55:
            return "You're most productive before noon - front-load your hardest task if you can."

    sleep_mood = patterns_by_description.get("sleep_mood_correlation")
    if sleep_mood is not None:
        return "Good rest fuels a good day - even a short wind-down last night helps today's focus."

    hyd = patterns_by_description.get("hydration_time_clusters")
    if hyd is not None:
        hours = hyd.get("hours") if isinstance(hyd, dict) else None
        hours_list = hours if isinstance(hours, list) else []
        if len(hours_list) > 0:
            first_two = hours_list[:2]
            formatted = " and ".join([f"{int(h)}:00" for h in first_two])
            return f"You often hydrate around {formatted} - stacking water with those habits keeps energy steadier."

    return "Small wins early build momentum. Pick one priority and finish it before lunch."


def _format_morning_plan_notification_body(p: dict[str, Any]) -> str:
    lines: list[str] = [p["greeting"]]
    if p["energyCheck"]:
        lines.append("Energy check: log how you feel to plan your day better.")
    if p["topPriorities"]:
        lines.append("Priorities: " + " · ".join(p["topPriorities"]))
    else:
        lines.append("No open tasks - great time for deep work or planning.")
    action_email_count = p.get("actionEmailCount")
    if isinstance(action_email_count, int) and action_email_count > 3:
        lines.append(f"{action_email_count} emails need replies - block 20 min to clear the deck?")
    if p["risks"]:
        lines.append("Heads-up: " + p["risks"][0])
    lines.append(p["coachNote"])
    return "\n".join(lines)


def format_morning_plan_notification_body(p: dict[str, Any]) -> str:
    return _format_morning_plan_notification_body(p)


async def generate_morning_plan(
    user_id: str, local_now: Optional[datetime] = None
) -> dict[str, Any]:
    """
    Port of coaching.ts generateMorningPlan().
    """
    anchor = _coach_anchor_now(local_now)
    tz = anchor.tzinfo or timezone.utc
    today_str = anchor.date().isoformat()
    hour = anchor.hour

    greeting = _greeting_for_hour(hour)

    async with async_session() as session:
        # Energy check: if no mood logged today
        mood_row = (
            await session.execute(
                select(MoodLogModel)
                .where(MoodLogModel.user_id == user_id)
                .order_by(MoodLogModel.logged_at.desc())
            )
        ).scalars().all()
        today_mood = None
        for m in mood_row:
            dt = _parse_dt(m.logged_at)
            if dt and _local_date_str(dt, tz) == today_str:
                today_mood = m
                break
        energy_check = today_mood is None

        # Pending tasks and due today
        pending_tasks = (
            await session.execute(
                select(Task).where(Task.user_id == user_id, Task.status == "pending")
            )
        ).scalars().all()

        def _due_date_date(t: Task) -> Optional[str]:
            if not t.due_date:
                return None
            raw = (t.due_date or "").strip()
            if len(raw) <= 10 and raw.count("-") == 2:
                return raw[:10]
            dt = _parse_dt(t.due_date)
            return _local_date_str(dt, tz) if dt else None

        due_today = []
        for t in pending_tasks:
            d = _due_date_date(t)
            if d == today_str:
                due_today.append(t)

        # Sort pending tasks: same semantics as coaching.ts
        pri = {"high": 3, "medium": 2, "low": 1}

        def sort_key(t: Task) -> tuple[int, int, str]:
            # Higher priority first; tasks without due_date last.
            p = pri.get(t.priority or "", 0)
            due_d = _due_date_date(t)
            no_due_flag = 1 if not due_d else 0
            return (-p, no_due_flag, due_d or "")

        sorted_tasks = sorted(pending_tasks, key=sort_key)
        top_priorities = [t.title for t in sorted_tasks[:3] if t.title]

        # Calendar events today (start_time is same day) for schedule + risks
        cal_events = (
            await session.execute(
                select(CalendarEventModel).where(CalendarEventModel.user_id == user_id)
            )
        ).scalars().all()
        timed_today = []
        for e in cal_events:
            if e.all_day:
                continue
            st = _parse_dt(e.start_time)
            if st and _local_date_str(st, tz) == today_str:
                timed_today.append(e)
        timed_today.sort(key=lambda e: e.start_time or "")

        schedule: list[dict[str, Any]] = []
        for e in timed_today[:8]:
            schedule.append(
                {
                    "start": e.start_time,
                    "end": e.end_time,
                    "label": e.summary,
                    "type": "event",
                }
            )
        for t in due_today[:3]:
            schedule.append({"start": "", "end": "", "label": t.title, "type": "task"})

        risks: list[str] = []
        risks.extend(_back_to_back_risk(timed_today))

        # Under-6h sleep risk based on latest sleep_end being from yesterday.
        last_sleep = (
            await session.execute(
                select(SleepSessionModel)
                .where(SleepSessionModel.user_id == user_id)
                .order_by(SleepSessionModel.sleep_start.desc())
            )
        ).scalars().first()
        if last_sleep and last_sleep.sleep_end:
            sleep_end_dt = _parse_dt(last_sleep.sleep_end)
            if sleep_end_dt:
                yesterday_str = (anchor.date() - timedelta(days=1)).isoformat()
                if _local_date_str(sleep_end_dt, tz) == yesterday_str:
                    hrs = (last_sleep.duration_minutes or 0) / 60.0
                    if hrs > 0 and hrs < 6:
                        risks.append(
                            "You had under 6h sleep - pace yourself and protect one focus block."
                        )

        # Overdue tasks
        overdue = []
        for t in pending_tasks:
            if not t.due_date:
                continue
            d = _due_date_date(t)
            if d and d < today_str:
                overdue.append(t)
        if overdue:
            risks.append(
                f"{len(overdue)} overdue task(s) - consider triaging or rescheduling one today."
            )

        # Action-needed emails (count categories)
        action_email_count = (
            await session.execute(
                select(EmailCategoryModel).where(
                    EmailCategoryModel.user_id == user_id,
                    EmailCategoryModel.category == "action_needed",
                )
            )
        ).scalars().all()
        action_email_count_int = len(action_email_count)

        # Patterns used for coach note
        needed_descriptions = {
            "task_completion_time",
            "sleep_mood_correlation",
            "hydration_time_clusters",
        }
        patterns_rows = (
            await session.execute(
                select(BehaviorPatternModel).where(
                    BehaviorPatternModel.user_id == user_id,
                    BehaviorPatternModel.description.in_(needed_descriptions),
                )
            )
        ).scalars().all()
        patterns_by_desc: dict[str, dict[str, Any]] = {}
        for p in patterns_rows:
            try:
                patterns_by_desc[p.description] = json.loads(p.data or "{}")
            except json.JSONDecodeError:
                patterns_by_desc[p.description] = {}

        coach_note = _build_coach_note(patterns_by_desc, hour)

        return {
            "greeting": greeting,
            "energyCheck": energy_check,
            "topPriorities": top_priorities,
            "schedule": schedule,
            "risks": risks,
            "coachNote": coach_note,
            "actionEmailCount": action_email_count_int,
        }


async def generate_weekly_review(
    user_id: str, local_now: Optional[datetime] = None
) -> dict[str, Any]:
    """
    Port of coaching.ts generateWeeklyReview().
    """
    anchor = _coach_anchor_now(local_now)
    week_cutoff = (anchor.date() - timedelta(days=35)).isoformat()
    today_str = anchor.date().isoformat()

    async with async_session() as session:
        streak_rows = (
            await session.execute(
                select(DailyStreakModel)
                .where(DailyStreakModel.user_id == user_id, DailyStreakModel.date >= week_cutoff)
                .order_by(DailyStreakModel.date.asc())
            )
        ).scalars().all()
        scores = [r.score or 0 for r in streak_rows]

        week_avgs: list[int] = []
        for i in range(len(scores), 0, -7):
            chunk = scores[max(0, i - 7) : i]
            if chunk:
                week_avgs.append(round(sum(chunk) / len(chunk)))

        trend_data = week_avgs[-4:]
        if trend_data:
            week_score = trend_data[-1]
        elif scores:
            week_score = scores[-1]
        else:
            week_score = 0

        trend = "stable"
        if len(trend_data) >= 2:
            a = trend_data[-2]
            b = trend_data[-1]
            if b > a + 5:
                trend = "improving"
            elif b < a - 5:
                trend = "declining"

        # Patterns used for weekly messaging
        hyd_pattern_row = (
            await session.execute(
                select(BehaviorPatternModel).where(
                    BehaviorPatternModel.user_id == user_id,
                    BehaviorPatternModel.description == "daily_hydration_average",
                )
            )
        ).scalars().first()
        hyd_pattern_data: Optional[dict[str, Any]] = None
        if hyd_pattern_row:
            try:
                hyd_pattern_data = json.loads(hyd_pattern_row.data or "{}")
            except json.JSONDecodeError:
                hyd_pattern_data = {}

        top_win = (
            "Steady hydration pattern - keep visibility of water at your desk."
            if hyd_pattern_data is not None
            else "You showed up this week - consistency counts more than perfection."
        )

        # Pending tasks count
        pending_count = (
            await session.execute(
                select(Task).where(Task.user_id == user_id, Task.status == "pending")
            )
        ).scalars().all()
        pending_total = len(pending_count)
        top_challenge = (
            f"Task backlog ({pending_total}) - pick one theme to chip away next week."
            if pending_total > 12
            else "Protect time for rest between intense days."
        )

        # Correlations (port semantics; TS checks for data.r which may be absent)
        correlations: list[str] = []
        sm_row = (
            await session.execute(
                select(BehaviorPatternModel).where(
                    BehaviorPatternModel.user_id == user_id,
                    BehaviorPatternModel.description == "sleep_mood_correlation",
                )
            )
        ).scalars().first()
        if sm_row:
            try:
                sm_data = json.loads(sm_row.data or "{}")
            except json.JSONDecodeError:
                sm_data = {}
            if sm_data.get("r") is not None:
                correlations.append(
                    "Better sleep nights line up with better next-day mood in your history."
                )

        next_week_focus = (
            "Focus on: one daily anchor (sleep, water, or first task before noon)."
            if trend == "declining"
            else "Focus on: morning task completion - compound small wins."
        )

        commitment_review = "New week - one small experiment is enough."
        c_cutoff = (now_ - timedelta(days=7)).date().isoformat()
        c_rows = (
            await session.execute(
                select(CoachCommitmentModel).where(
                    CoachCommitmentModel.user_id == user_id,
                    CoachCommitmentModel.date_suggested >= c_cutoff,
                )
            )
        ).scalars().all()
        if c_rows:
            adopted = sum(1 for r in c_rows if r.adopted)
            commitment_review = f"You adopted {adopted}/{len(c_rows)} coach suggestions this week."

        return {
            "weekScore": int(week_score),
            "trend": trend,
            "trendData": [int(x) for x in trend_data],
            "topWin": top_win,
            "topChallenge": top_challenge,
            "correlations": correlations,
            "nextWeekFocus": next_week_focus,
            "commitmentReview": commitment_review,
        }


def format_weekly_coach_body(w: dict[str, Any]) -> str:
    lines = [
        f"Week in review (score ~{w['weekScore']}/100, {w['trend']})",
        f"Win: {w['topWin']}",
        f"Challenge: {w['topChallenge']}",
        w["commitmentReview"],
        w["nextWeekFocus"],
    ]
    if w.get("correlations"):
        lines.append(" ".join(w["correlations"]))
    lines.append("What ONE thing will you commit to next week?")
    return "\n".join(lines)


def format_partner_weekly_prompt(score: int) -> str:
    return (
        f"Share your week's progress with your partner? Score: {score}/100 "
        "(optional - accountability helps some people stay on track)."
    )


def _build_causal_analysis(
    today_events: list[CalendarEventModel],
    completed_today: int,
    pending_count: int,
    hyd_pct: int,
) -> tuple[list[dict[str, str]], Optional[dict[str, str]]]:
    causal: list[dict[str, str]] = []
    suggestion: Optional[dict[str, str]] = None

    # backToBackAfternoon check
    back_to_back_afternoon = False
    for i in range(0, len(today_events) - 1):
        a = today_events[i]
        b = today_events[i + 1]
        a_start_dt = _parse_dt(a.start_time)
        a_end_dt = _parse_dt(a.end_time)
        b_start_dt = _parse_dt(b.start_time)
        if not a_start_dt or not a_end_dt or not b_start_dt:
            continue
        a_start_hour = a_start_dt.hour
        if a_start_hour >= 14:
            gap_min = int((b_start_dt - a_end_dt).total_seconds() / 60)
            if gap_min >= 0 and gap_min < 15:
                back_to_back_afternoon = True
                break

    if completed_today == 0 and pending_count > 0:
        if back_to_back_afternoon:
            causal.append(
                {
                    "observation": "You completed 0 tasks after midday.",
                    "likelyCause": "Back-to-back meetings in the afternoon may have left no focus window.",
                    "evidence": "This pattern matches cramped calendar gaps today.",
                }
            )
            suggestion = {
                "suggestion": "Block 30 minutes after your last meeting for task catch-up.",
                "reason": "You lose momentum when meetings end and nothing is scheduled.",
                "difficulty": "easy",
            }
        else:
            causal.append(
                {
                    "observation": "No tasks checked off today despite open items.",
                    "likelyCause": "Energy or unclear next step on the hardest task.",
                    "evidence": "Low completion with pending backlog.",
                }
            )
            suggestion = {
                "suggestion": "Tomorrow, spend 10 minutes on the smallest pending task first.",
                "reason": "A quick win builds momentum before harder work.",
                "difficulty": "easy",
            }

    if hyd_pct < 50 and len(today_events) >= 3:
        causal.append(
            {
                "observation": f"Hydration only {hyd_pct}% with a busy calendar.",
                "likelyCause": "Meetings reduce natural water breaks.",
                "evidence": "Hydration often trails on high meeting days.",
            }
        )
        if suggestion is None:
            suggestion = {
                "suggestion": "Keep a full bottle visible before your first meeting.",
                "reason": "Visual cues beat memory when you are back-to-back.",
                "difficulty": "easy",
            }

    return causal, suggestion


async def generate_evening_reflection(
    user_id: str, local_now: Optional[datetime] = None
) -> dict[str, Any]:
    """
    Port of generateDailyReflection() + only the fields needed by formatEveningCoach().
    """
    anchor = _coach_anchor_now(local_now)
    tz = anchor.tzinfo or timezone.utc
    today_str = anchor.date().isoformat()
    yesterday_str = (anchor.date() - timedelta(days=1)).isoformat()
    hyd_goal_ml = 2500

    async with async_session() as session:
        # Hydration sum today
        hyd_logs = (
            await session.execute(
                select(HydrationLog).where(HydrationLog.user_id == user_id)
            )
        ).scalars().all()
        hydration_today_ml = 0
        for l in hyd_logs:
            dt = _parse_dt(l.timestamp)
            if dt and _local_date_str(dt, tz) == today_str:
                hydration_today_ml += int(l.amount_ml or 0)

        hyd_pct = round((hydration_today_ml / hyd_goal_ml) * 100) if hyd_goal_ml else 0

        # Tasks completed today and pending count
        tasks = (await session.execute(select(Task).where(Task.user_id == user_id))).scalars().all()
        completed_today = 0
        pending_count = 0
        for t in tasks:
            if t.status == "pending":
                pending_count += 1
            if t.status == "completed" and t.updated_at:
                if _local_date_str(t.updated_at, tz) == today_str:
                    completed_today += 1

        # Latest sleep session
        last_sleep = (
            await session.execute(
                select(SleepSessionModel)
                .where(SleepSessionModel.user_id == user_id)
                .order_by(SleepSessionModel.sleep_start.desc())
            )
        ).scalars().first()

        # Mood logged today (latest)
        mood_today: Optional[MoodLogModel] = None
        for m in (
            await session.execute(
                select(MoodLogModel)
                .where(MoodLogModel.user_id == user_id)
                .order_by(MoodLogModel.logged_at.desc())
            )
        ).scalars().all():
            dt = _parse_dt(m.logged_at)
            if dt and _local_date_str(dt, tz) == today_str:
                mood_today = m
                break

        # Calendar events today (non all_day)
        cal_events = (
            await session.execute(
                select(CalendarEventModel).where(CalendarEventModel.user_id == user_id)
            )
        ).scalars().all()
        today_events: list[CalendarEventModel] = []
        for e in cal_events:
            if e.all_day:
                continue
            st = _parse_dt(e.start_time)
            if st and _local_date_str(st, tz) == today_str:
                today_events.append(e)
        today_events.sort(key=lambda e: e.start_time or "")

        # Causal analysis
        causal_insights, coaching_suggestion = _build_causal_analysis(
            today_events=today_events,
            completed_today=completed_today,
            pending_count=pending_count,
            hyd_pct=hyd_pct,
        )

        # Adjustments (only used for formatEveningCoach adjustments[0])
        adjustments: list[str] = []
        if hyd_pct < 80:
            adjustments.append("Consider setting earlier reminders or keeping water visible.")

        if mood_today and (mood_today.energy or 0) <= 2:
            adjustments.append("Note one drain - your coach uses it for weekly patterns.")

        last_sleep_adjusted: Optional[float] = None
        if last_sleep and last_sleep.sleep_end:
            end_dt = _parse_dt(last_sleep.sleep_end)
            if end_dt and _local_date_str(end_dt, tz) == today_str:
                hrs = round(((last_sleep.duration_minutes or 0) / 60.0) * 10) / 10
                last_sleep_adjusted = hrs
                if hrs < 7:
                    adjustments.append("Try winding down 30 minutes earlier tomorrow.")

        if completed_today == 0 and pending_count > 0:
            adjustments.append("Start tomorrow with one quick win to build momentum.")

        # Score
        score = 50
        score += min(20, hyd_pct / 5)
        score += min(15, completed_today * 3)
        if last_sleep:
            hrs = (last_sleep.duration_minutes or 0) / 60.0
            score += 10 if hrs >= 7 else 5 if hrs >= 6 else 0
        if mood_today:
            m = mood_today.mood or 0
            score += 5 if m >= 4 else 2 if m >= 3 else 0
        score = min(100, max(0, round(score)))

        # Commitment check for yesterday
        commitment_check: Optional[str] = None
        y_commit = (
            await session.execute(
                select(CoachCommitmentModel)
                .where(
                    CoachCommitmentModel.user_id == user_id,
                    CoachCommitmentModel.date_suggested == yesterday_str,
                )
                .order_by(CoachCommitmentModel.created_at.desc())
                .limit(1)
            )
        ).scalars().first()
        if y_commit:
            snippet = (y_commit.suggestion or "")[:120]
            if len(y_commit.suggestion or "") > 120:
                snippet += "..."
            if y_commit.adopted:
                commitment_check = f'Yesterday you tried: "{snippet}" - nice follow-through.'
            else:
                commitment_check = f'Yesterday I suggested: "{snippet}" - did you try it?'

        # Upsert today's commitment if suggestion exists
        if coaching_suggestion:
            existing = (
                await session.execute(
                    select(CoachCommitmentModel).where(
                        CoachCommitmentModel.user_id == user_id,
                        CoachCommitmentModel.date_suggested == today_str,
                    )
                    .limit(1)
                )
            ).scalars().first()
            if not existing:
                cc = CoachCommitmentModel(
                    id=generate_id(),
                    user_id=user_id,
                    suggestion=coaching_suggestion["suggestion"],
                    reason=coaching_suggestion.get("reason"),
                    date_suggested=today_str,
                    date_due=(anchor.date() + timedelta(days=1)).isoformat(),
                    adopted=False,
                    outcome=None,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(cc)
                await session.commit()

        return {
            "score": score,
            "causalInsights": causal_insights,
            "coachingSuggestion": coaching_suggestion,
            "adjustments": adjustments,
            "commitmentCheck": commitment_check,
        }


def format_evening_coach(r: dict[str, Any]) -> str:
    parts = [f"Evening check-in - score {r['score']}/100."]
    if r.get("commitmentCheck"):
        parts.append(r["commitmentCheck"])
    causal = r.get("causalInsights") or []
    if causal:
        c = causal[0]
        parts.append(f"{c['observation']} {c['likelyCause']}")
    if r.get("coachingSuggestion"):
        parts.append(f"Coach note: {r['coachingSuggestion']['suggestion']}")
    else:
        adjustments = r.get("adjustments") or []
        if adjustments:
            parts.append(adjustments[0])
    return "\n".join(parts)

