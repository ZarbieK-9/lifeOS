"""JWT token creation/verification and password hashing."""

import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt, JWTError

from app.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(
        {"sub": user_id, "exp": exp, "type": "access"},
        settings.JWT_SECRET,
        settings.JWT_ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    return jwt.encode(
        {"sub": user_id, "exp": exp, "type": "refresh"},
        settings.JWT_SECRET,
        settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises JWTError on failure."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        raise


def generate_id() -> str:
    return str(uuid.uuid4())
