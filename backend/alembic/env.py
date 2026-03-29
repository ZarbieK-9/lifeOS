"""Alembic migration environment (sync engine; DATABASE_URL may use +asyncpg)."""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Ensure `app` package resolves when running `alembic` from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db import Base  # noqa: E402
from app import models  # noqa: F401, E402 — register metadata tables

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    raw = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://lifeos:lifeos@localhost:5432/lifeos",
    )
    if "+asyncpg" in raw:
        return raw.replace("+asyncpg", "+psycopg2", 1)
    if raw.startswith("postgresql://") and "+" not in raw.split("://", 1)[0]:
        return raw
    # e.g. postgresql+psycopg://
    return raw


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
