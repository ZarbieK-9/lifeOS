"""SQLAlchemy models — mirrors mobile SQLite schema + user management."""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, Float
from sqlalchemy.sql import func

from app.db import Base


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, default="")
    partner_id = Column(String, nullable=True)
    mqtt_username = Column(String, nullable=True)
    mqtt_password = Column(String, nullable=True)
    coach_timezone = Column(String, nullable=True)  # IANA; NULL uses Settings.COACH_TIMEZONE
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Task(Base):
    __tablename__ = "tasks"

    task_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    due_date = Column(String, nullable=True)
    priority = Column(String, default="medium")
    notes = Column(Text, default="")
    status = Column(String, default="pending")
    recurrence = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class HydrationLog(Base):
    __tablename__ = "hydration_logs"

    log_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    amount_ml = Column(Integer, nullable=False)
    timestamp = Column(String, nullable=False)
    synced = Column(Boolean, default=True)


class PartnerSnippetModel(Base):
    __tablename__ = "partner_snippets"

    snippet_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    partner_id = Column(String, nullable=False)
    content = Column(Text, default="")
    timestamp = Column(String, nullable=True)
    synced = Column(Boolean, default=True)


class SleepSessionModel(Base):
    __tablename__ = "sleep_sessions"

    session_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    sleep_start = Column(String, nullable=False)
    sleep_end = Column(String, nullable=True)
    duration_minutes = Column(Integer, default=0)


class ReminderModel(Base):
    __tablename__ = "reminders"

    reminder_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    trigger_at = Column(String, nullable=False)
    fired = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AiCommandModel(Base):
    __tablename__ = "ai_commands"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    input = Column(Text, nullable=False)
    output = Column(Text, nullable=True)
    status = Column(String, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AutomationRuleModel(Base):
    __tablename__ = "automation_rules"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    rule_type = Column(String, nullable=False)  # schedule | condition
    schedule = Column(String, nullable=True)     # cron expression
    condition = Column(Text, nullable=True)       # JSON rules-engine condition
    actions = Column(Text, nullable=False)        # JSON array of {tool, params}
    enabled = Column(Boolean, default=True)
    last_triggered = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ApiKeyModel(Base):
    __tablename__ = "api_keys"

    key_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    key_hash = Column(String, nullable=False)       # SHA-256 hex digest
    key_prefix = Column(String(8), nullable=False)   # first 8 chars for display
    name = Column(String, nullable=False, default="default")
    last_used = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RoutineModel(Base):
    __tablename__ = "routines"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    trigger_phrases = Column(Text, nullable=False)  # JSON array
    steps = Column(Text, nullable=False)             # JSON array of {tool, params}
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Coach migration: additional tables to support server-side coach compute ──

class MoodLogModel(Base):
    __tablename__ = "mood_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    mood = Column(Integer, nullable=False)
    energy = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    logged_at = Column(String, nullable=False)


class HabitModel(Base):
    __tablename__ = "habits"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    icon = Column(String, default="✓")
    target_per_day = Column(Integer, default=1)
    unit = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(String, nullable=True)


class HabitLogModel(Base):
    __tablename__ = "habit_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    habit_id = Column(String, nullable=False)
    value = Column(Integer, default=1)
    logged_at = Column(String, nullable=False)


class NoteModel(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, default="")
    category = Column(String, default="note")
    pinned = Column(Boolean, default=False)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


class InboxItemModel(Base):
    __tablename__ = "inbox_items"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    triaged = Column(Boolean, default=False)
    triage_result = Column(Text, nullable=True)
    created_at = Column(String, nullable=True)


class ExpenseModel(Base):
    __tablename__ = "expenses"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="USD")
    category = Column(String, default="other")
    description = Column(Text, nullable=True)
    date = Column(String, nullable=False)  # YYYY-MM-DD (mobile uses date as string)
    created_at = Column(String, nullable=True)


class BudgetModel(Base):
    __tablename__ = "budgets"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    category = Column(String, nullable=False)
    monthly_limit = Column(Float, nullable=False)
    currency = Column(String, default="USD")
    created_at = Column(String, nullable=True)


class BehaviorPatternModel(Base):
    __tablename__ = "behavior_patterns"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    domain = Column(String, nullable=False)
    pattern_type = Column(String, nullable=False)
    description = Column(String, nullable=False)
    data = Column(Text, nullable=False)
    confidence = Column(Float, default=0.5)
    sample_count = Column(Integer, default=0)
    last_updated = Column(String, nullable=True)
    created_at = Column(String, nullable=True)


class DailyStreakModel(Base):
    __tablename__ = "daily_streaks"

    date = Column(String, primary_key=True)  # YYYY-MM-DD
    user_id = Column(String, ForeignKey("users.user_id"), primary_key=True, index=True)
    hydration_met = Column(Integer, default=0)
    tasks_completed = Column(Integer, default=0)
    sleep_logged = Column(Integer, default=0)
    habits_done = Column(Integer, default=0)
    score = Column(Integer, default=0)


class CalendarEventModel(Base):
    __tablename__ = "calendar_events"

    event_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    summary = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    location = Column(Text, nullable=True)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    all_day = Column(Boolean, default=False)
    status = Column(String, default="confirmed")
    html_link = Column(Text, nullable=True)
    google_calendar_id = Column(String, default="primary")
    synced_at = Column(String, nullable=True)
    raw_json = Column(Text, nullable=True)


class EmailCacheModel(Base):
    __tablename__ = "email_cache"

    message_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    thread_id = Column(String, nullable=False)
    from_address = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    snippet = Column(Text, nullable=True)
    date = Column(String, nullable=False)
    is_unread = Column(Boolean, default=True)
    is_starred = Column(Boolean, default=False)
    label_ids = Column(Text, nullable=True)
    body_text = Column(Text, nullable=True)
    synced_at = Column(String, nullable=True)


class EmailCategoryModel(Base):
    __tablename__ = "email_categories"

    message_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    category = Column(String, nullable=False)
    extracted_tasks = Column(Text, nullable=True)
    categorized_at = Column(String, nullable=False)


class CoachCommitmentModel(Base):
    __tablename__ = "coaching_commitments"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    suggestion = Column(Text, nullable=False)
    reason = Column(Text, nullable=True)
    date_suggested = Column(String, nullable=False)
    date_due = Column(String, nullable=True)
    adopted = Column(Boolean, default=False)
    outcome = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CoachNotificationModel(Base):
    __tablename__ = "coach_notifications"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    domain = Column(String, nullable=False, default="productivity")
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    priority = Column(String, nullable=False, default="low")  # high | low
    read = Column(Boolean, default=False)
    acted_on = Column(Integer, default=0)
    rule_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExpoPushTokenModel(Base):
    __tablename__ = "expo_push_tokens"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    device_id = Column(String, nullable=True)
    token = Column(Text, nullable=False)
    platform = Column(String, nullable=True)  # ios | android
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SyncEventReceiptModel(Base):
    __tablename__ = "sync_event_receipts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    event_id = Column(String, nullable=False, index=True)
    event_type = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebhookReplayGuardModel(Base):
    __tablename__ = "webhook_replay_guard"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    request_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentOutcomeModel(Base):
    __tablename__ = "agent_outcomes"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    source = Column(String, nullable=False)
    tool = Column(String, nullable=False)
    outcome = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
