"""
Deterministic coach pattern + daily score engine (server-side).

Ports the on-device deterministic logic from:
- frontend/src/agent/patterns.ts
- frontend/src/store/useStore.ts (updateDailyStreak)

This module does not call any LLM.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.auth import generate_id
from app.db import async_session
from app.models import (
    MoodLogModel,
    HabitLogModel,
    HabitModel,
    Task,
    HydrationLog,
    SleepSessionModel,
    ExpenseModel,
    BehaviorPatternModel,
    DailyStreakModel,
)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    # Normalize common ISO formats.
    # - '...Z' -> '+00:00'
    v = value.replace("Z", "+00:00") if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        # Fallback: best-effort parse (caller can treat as missing)
        return None


def _parse_date_str(value: str) -> Optional[datetime.date]:
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        # Expect YYYY-MM-DD
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _local_date_str(dt: datetime, tz: Any) -> str:
    return dt.astimezone(tz).date().isoformat()


def _cluster_hours(timestamps: list[str]) -> list[int]:
    """
    Port of frontend/src/agent/patterns.ts clusterHours().
    Returns hours with frequency >= 20% of samples.
    """
    if len(timestamps) < 3:
        return []
    hours: list[int] = []
    for t in timestamps:
        dt = _parse_dt(t)
        if not dt:
            continue
        hours.append(dt.hour)
    if len(hours) < 3:
        return []

    freq: dict[int, int] = {}
    for h in hours:
        freq[h] = freq.get(h, 0) + 1

    threshold = len(hours) * 0.2
    clustered = [h for h, count in freq.items() if count >= threshold]
    return sorted(clustered)


@dataclass
class PatternResult:
    domain: str
    pattern_type: str
    description: str
    data: dict[str, Any]
    confidence: float
    sample_count: int


async def update_daily_streak(
    user_id: str, hydration_goal_ml: int = 2500, local_now: Optional[datetime] = None
) -> None:
    """
    Port of frontend/src/store/useStore.ts updateDailyStreak().

    If local_now is timezone-aware, uses that calendar day in that zone; else UTC.
    """
    if local_now is not None and local_now.tzinfo is not None:
        anchor = local_now
    else:
        anchor = datetime.now(timezone.utc)
    tz = anchor.tzinfo or timezone.utc
    today_str = anchor.date().isoformat()

    async with async_session() as session:
        hyd_rows = await session.execute(
            select(HydrationLog).where(HydrationLog.user_id == user_id)
        )
        # Filter in python because HydrationLog.timestamp is stored as string
        hydration_today_ml = 0
        for r in hyd_rows.scalars().all():
            dt = _parse_dt(r.timestamp)
            if not dt:
                continue
            if _local_date_str(dt, tz) == today_str:
                hydration_today_ml += r.amount_ml

        hydration_met = 1 if hydration_today_ml >= hydration_goal_ml else 0

        # Tasks completed today: mobile checks dayjs(updated_at).format('YYYY-MM-DD') == today
        task_rows = await session.execute(
            select(Task).where(Task.user_id == user_id)
        )
        tasks_completed = 0
        for t in task_rows.scalars().all():
            if t.status != "completed":
                continue
            if not t.updated_at:
                continue
            if _local_date_str(t.updated_at, tz) == today_str:
                tasks_completed += 1

        sleep_logged = 0
        sleep_rows = await session.execute(
            select(SleepSessionModel).where(SleepSessionModel.user_id == user_id)
        )
        for s in sleep_rows.scalars().all():
            # Best-effort: treat sleep_end on today as the "today sleep".
            end_dt = _parse_dt(s.sleep_end) if getattr(s, "sleep_end", None) else None
            if end_dt and _local_date_str(end_dt, tz) == today_str and s.duration_minutes > 0:
                sleep_logged = 1
                break

        habits_done = 0
        habit_log_rows = await session.execute(
            select(HabitLogModel).where(HabitLogModel.user_id == user_id)
        )
        for l in habit_log_rows.scalars().all():
            dt = _parse_dt(l.logged_at)
            if not dt:
                continue
            if _local_date_str(dt, tz) == today_str:
                habits_done += l.value

        # Scoring (same caps as TS)
        hydration_pts = hydration_met * 30
        task_pts = min(tasks_completed * 10, 40)
        sleep_pts = sleep_logged * 20
        habit_pts = min(habits_done * 10, 10)
        score = hydration_pts + task_pts + sleep_pts + habit_pts

        # Upsert daily_streak row for today
        ds = DailyStreakModel(
            user_id=user_id,
            date=today_str,
            hydration_met=hydration_met,
            tasks_completed=tasks_completed,
            sleep_logged=sleep_logged,
            habits_done=habits_done,
            score=score,
        )
        session.merge(ds)
        await session.commit()


async def analyze_and_persist_patterns(user_id: str) -> list[PatternResult]:
    """
    Port of frontend/src/agent/patterns.ts analyzePatterns()
    with persistence to behavior_patterns.
    """
    now = _now_utc()
    cutoff_30 = now - timedelta(days=30)

    patterns: list[PatternResult] = []

    async with async_session() as session:
        # ── Hydration patterns ──
        hyd_logs = (await session.execute(select(HydrationLog).where(HydrationLog.user_id == user_id))).scalars().all()
        hyd_samples: list[dict[str, Any]] = []
        for l in hyd_logs:
            dt = _parse_dt(l.timestamp)
            if not dt:
                continue
            if dt < cutoff_30:
                continue
            hyd_samples.append({"timestamp": l.timestamp, "amount_ml": l.amount_ml})

        if len(hyd_samples) >= 5:
            clusters = _cluster_hours([s["timestamp"] for s in hyd_samples])
            if len(clusters) >= 2:
                avg_ml = round(sum(s["amount_ml"] for s in hyd_samples) / len(hyd_samples))
                patterns.append(
                    PatternResult(
                        domain="health",
                        pattern_type="time_habit",
                        description="hydration_time_clusters",
                        data={"hours": clusters, "avgMl": avg_ml},
                        confidence=min(0.9, 0.3 + len(hyd_samples) * 0.02),
                        sample_count=len(hyd_samples),
                    )
                )

            # Average daily intake + min/max
            daily_totals: dict[str, float] = {}
            for s in hyd_samples:
                dt = _parse_dt(s["timestamp"])
                if not dt:
                    continue
                day = dt.date().isoformat()
                daily_totals[day] = daily_totals.get(day, 0) + float(s["amount_ml"])
            days = list(daily_totals.values())
            if len(days) >= 3:
                avg_daily = sum(days) / len(days)
                patterns.append(
                    PatternResult(
                        domain="health",
                        pattern_type="preference",
                        description="daily_hydration_average",
                        data={
                            "avgMl": round(avg_daily),
                            "minMl": min(days),
                            "maxMl": max(days),
                        },
                        confidence=min(0.9, 0.4 + len(days) * 0.03),
                        sample_count=len(days),
                    )
                )

        # ── Sleep patterns ──
        sleep_rows = (
            await session.execute(select(SleepSessionModel).where(SleepSessionModel.user_id == user_id))
        ).scalars().all()
        sessions = []
        for s in sleep_rows:
            start_dt = _parse_dt(s.sleep_start)
            if not start_dt or start_dt < cutoff_30:
                continue
            if not s.sleep_end:
                continue
            sessions.append(s)

        if len(sessions) >= 3:
            bedtime_hours: list[float] = []
            wake_hours: list[float] = []
            durations: list[int] = []
            for s in sessions:
                start_dt = _parse_dt(s.sleep_start)
                end_dt = _parse_dt(s.sleep_end)
                if not start_dt or not end_dt:
                    continue
                bedtime_hours.append(start_dt.hour + start_dt.minute / 60)
                wake_hours.append(end_dt.hour + end_dt.minute / 60)
                durations.append(int(s.duration_minutes))

            if len(bedtime_hours) >= 3:
                avg_bed = sum(bedtime_hours) / len(bedtime_hours)
                avg_wake = sum(wake_hours) / len(wake_hours)
                avg_dur = sum(durations) / len(durations) if durations else 0
                patterns.append(
                    PatternResult(
                        domain="health",
                        pattern_type="time_habit",
                        description="sleep_schedule",
                        data={
                            "avgBedtimeHour": round(avg_bed * 10) / 10,
                            "avgWakeHour": round(avg_wake * 10) / 10,
                            "avgDurationMin": round(avg_dur),
                        },
                        confidence=min(0.9, 0.3 + len(sessions) * 0.05),
                        sample_count=len(sessions),
                    )
                )

        # ── Mood patterns + correlations ──
        mood_rows = (
            await session.execute(select(MoodLogModel).where(MoodLogModel.user_id == user_id))
        ).scalars().all()
        mood_recent: list[MoodLogModel] = []
        for m in mood_rows:
            dt = _parse_dt(m.logged_at)
            if dt and dt > cutoff_30:
                mood_recent.append(m)

        if len(mood_recent) >= 3:
            cluster_mood = _cluster_hours([m.logged_at for m in mood_recent])
            if len(cluster_mood) >= 1:
                patterns.append(
                    PatternResult(
                        domain="health",
                        pattern_type="time_habit",
                        description="mood_log_times",
                        data={"hours": cluster_mood},
                        confidence=min(0.8, 0.3 + len(mood_recent) * 0.04),
                        sample_count=len(mood_recent),
                    )
                )

        # sleep_mood_correlation: join mood_logs with sleep_sessions by date(m.logged_at) == date(s.sleep_end)
        sleep_by_end_date: dict[str, list[SleepSessionModel]] = {}
        for s in sessions:
            end_dt = _parse_dt(s.sleep_end)
            if not end_dt:
                continue
            key = end_dt.date().isoformat()
            sleep_by_end_date.setdefault(key, []).append(s)

        joined: list[tuple[MoodLogModel, SleepSessionModel]] = []
        for m in mood_recent:
            m_dt = _parse_dt(m.logged_at)
            if not m_dt:
                continue
            key = m_dt.date().isoformat()
            for s in sleep_by_end_date.get(key, []):
                joined.append((m, s))

        if len(joined) >= 5:
            good_sleep = [m for (m, s) in joined if int(s.duration_minutes) >= 420]
            poor_sleep = [m for (m, s) in joined if int(s.duration_minutes) < 360]
            if len(good_sleep) >= 2 and len(poor_sleep) >= 2:
                good_avg = sum(x.mood for x in good_sleep) / len(good_sleep)
                poor_avg = sum(x.mood for x in poor_sleep) / len(poor_sleep)
                if good_avg > poor_avg + 0.3:
                    patterns.append(
                        PatternResult(
                            domain="health",
                            pattern_type="correlation",
                            description="sleep_mood_correlation",
                            data={
                                "goodSleepAvgMood": round(good_avg * 10) / 10,
                                "poorSleepAvgMood": round(poor_avg * 10) / 10,
                            },
                            confidence=min(0.85, 0.4 + len(joined) * 0.03),
                            sample_count=len(joined),
                        )
                    )

        # ── Task patterns ──
        task_rows = (
            await session.execute(select(Task).where(Task.user_id == user_id))
        ).scalars().all()
        task_recent = [t for t in task_rows if t.created_at and t.created_at.replace(tzinfo=timezone.utc) > cutoff_30]
        if len(task_recent) >= 5:
            priority_counts = {"low": 0, "medium": 0, "high": 0}
            for t in task_recent:
                if t.priority in priority_counts:
                    priority_counts[t.priority] += 1
            dominant = sorted(priority_counts.items(), key=lambda kv: kv[1], reverse=True)[0]
            if dominant[1] > len(task_recent) * 0.5:
                patterns.append(
                    PatternResult(
                        domain="productivity",
                        pattern_type="preference",
                        description="task_priority_preference",
                        data={"dominant": dominant[0], "counts": priority_counts},
                        confidence=min(0.85, dominant[1] / len(task_recent)),
                        sample_count=len(task_recent),
                    )
                )

            total = len(task_recent)
            completed = sum(1 for t in task_recent if t.status == "completed")
            if total >= 5:
                rate = completed / total if total else 0
                patterns.append(
                    PatternResult(
                        domain="productivity",
                        pattern_type="preference",
                        description="task_completion_rate",
                        data={
                            "rate": round(rate * 100) / 100,
                            "total": total,
                            "completed": completed,
                        },
                        confidence=min(0.9, 0.4 + total * 0.02),
                        sample_count=total,
                    )
                )

        # ── Spending patterns ──
        expense_rows = (
            await session.execute(select(ExpenseModel).where(ExpenseModel.user_id == user_id))
        ).scalars().all()
        expenses_recent: list[ExpenseModel] = []
        cutoff_day = cutoff_30.date()
        for e in expense_rows:
            d = _parse_date_str(e.date)
            if d and d > cutoff_day:
                expenses_recent.append(e)

        if len(expenses_recent) >= 3:
            daily_totals: dict[str, float] = {}
            for e in expenses_recent:
                daily_totals[e.date] = daily_totals.get(e.date, 0) + float(e.amount)
            days = list(daily_totals.values())
            avg_daily = sum(days) / len(days)

            cat_totals: dict[str, float] = {}
            for e in expenses_recent:
                cat_totals[e.category] = cat_totals.get(e.category, 0) + float(e.amount)
            top_cat = sorted(cat_totals.items(), key=lambda kv: kv[1], reverse=True)
            top_category = top_cat[0][0] if top_cat else "other"
            top_category_total = top_cat[0][1] if top_cat else 0

            patterns.append(
                PatternResult(
                    domain="finance",
                    pattern_type="preference",
                    description="spending_habits",
                    data={
                        "avgDaily": round(avg_daily * 100) / 100,
                        "topCategory": top_category,
                        "topCategoryTotal": top_category_total,
                        "categories": {k: v for k, v in cat_totals.items()},
                    },
                    confidence=min(0.85, 0.3 + len(expenses_recent) * 0.03),
                    sample_count=len(expenses_recent),
                )
            )

        # ── Habit patterns ──
        habit_log_rows = (
            await session.execute(select(HabitLogModel).where(HabitLogModel.user_id == user_id))
        ).scalars().all()
        habit_recent: list[HabitLogModel] = []
        for l in habit_log_rows:
            dt = _parse_dt(l.logged_at)
            if dt and dt > cutoff_30:
                habit_recent.append(l)

        if len(habit_recent) >= 5:
            clusters = _cluster_hours([l.logged_at for l in habit_recent])
            if len(clusters) >= 1:
                patterns.append(
                    PatternResult(
                        domain="health",
                        pattern_type="time_habit",
                        description="habit_log_times",
                        data={"hours": clusters},
                        confidence=min(0.8, 0.3 + len(habit_recent) * 0.03),
                        sample_count=len(habit_recent),
                    )
                )

        # Persist patterns (port of useStore.upsertPattern)
        now_iso = _now_utc().isoformat()
        for p in patterns:
            existing_q = await session.execute(
                select(BehaviorPatternModel).where(
                    (BehaviorPatternModel.user_id == user_id)
                    & (BehaviorPatternModel.domain == p.domain)
                    & (BehaviorPatternModel.pattern_type == p.pattern_type)
                    & (BehaviorPatternModel.description == p.description)
                )
            )
            existing = existing_q.scalar_one_or_none()
            if existing:
                existing.data = json.dumps(p.data)
                existing.confidence = float(p.confidence)
                existing.sample_count = int(p.sample_count)
                existing.last_updated = now_iso
                session.merge(existing)
            else:
                bp = BehaviorPatternModel(
                    id=generate_id(),
                    user_id=user_id,
                    domain=p.domain,
                    pattern_type=p.pattern_type,
                    description=p.description,
                    data=json.dumps(p.data),
                    confidence=float(p.confidence),
                    sample_count=int(p.sample_count),
                    last_updated=now_iso,
                    created_at=now_iso,
                )
                session.add(bp)

        await session.commit()

    return patterns

