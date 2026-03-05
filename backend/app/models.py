"""SQLAlchemy models — mirrors mobile SQLite schema + user management."""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
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
