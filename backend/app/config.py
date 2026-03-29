"""Application configuration loaded from environment variables."""

import os


class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://lifeos:lifeos@localhost:5432/lifeos",
    )
    # IANA timezone for server-side coach windows when per-user TZ is not set (e.g. "America/New_York").
    COACH_TIMEZONE: str = os.getenv("COACH_TIMEZONE", "UTC")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me-in-production")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    )
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(
        os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30")
    )
    MQTT_BROKER_HOST: str = os.getenv("MQTT_BROKER_HOST", "localhost")
    MQTT_BROKER_PORT: int = int(os.getenv("MQTT_BROKER_PORT", "1883"))
    MQTT_USERNAME: str = os.getenv("MQTT_USERNAME", "lifeos_server")
    MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "lifeos_server_pass")


settings = Settings()
