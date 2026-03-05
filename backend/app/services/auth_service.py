"""AuthService gRPC implementation."""

import grpc
from sqlalchemy import select

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_id,
)
from app.db import async_session
from app.models import User

# These imports will be available after protoc generation
from gen import lifeos_pb2, lifeos_pb2_grpc


class AuthServicer(lifeos_pb2_grpc.AuthServiceServicer):
    async def Register(self, request, context):
        async with async_session() as session:
            # Check if username already exists
            existing = await session.execute(
                select(User).where(User.username == request.username)
            )
            if existing.scalar_one_or_none():
                context.set_code(grpc.StatusCode.ALREADY_EXISTS)
                context.set_details("Username already taken")
                return lifeos_pb2.RegisterResponse()

            user_id = generate_id()
            # MQTT credentials = username for MQTT auth
            mqtt_user = f"user_{user_id[:8]}"
            mqtt_pass = generate_id()[:16]

            user = User(
                user_id=user_id,
                username=request.username,
                password_hash=hash_password(request.password),
                display_name=request.display_name or request.username,
                mqtt_username=mqtt_user,
                mqtt_password=mqtt_pass,
            )
            session.add(user)
            await session.commit()

            return lifeos_pb2.RegisterResponse(user_id=user_id)

    async def Login(self, request, context):
        async with async_session() as session:
            result = await session.execute(
                select(User).where(User.username == request.username)
            )
            user = result.scalar_one_or_none()

            if not user or not verify_password(request.password, user.password_hash):
                context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                context.set_details("Invalid username or password")
                return lifeos_pb2.TokenPair()

            return lifeos_pb2.TokenPair(
                access_token=create_access_token(user.user_id),
                refresh_token=create_refresh_token(user.user_id),
                user_id=user.user_id,
            )

    async def Refresh(self, request, context):
        try:
            payload = decode_token(request.refresh_token)
            if payload.get("type") != "refresh":
                context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                context.set_details("Invalid token type")
                return lifeos_pb2.TokenPair()

            user_id = payload["sub"]

            # Verify user still exists
            async with async_session() as session:
                result = await session.execute(
                    select(User).where(User.user_id == user_id)
                )
                if not result.scalar_one_or_none():
                    context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                    context.set_details("User not found")
                    return lifeos_pb2.TokenPair()

            return lifeos_pb2.TokenPair(
                access_token=create_access_token(user_id),
                refresh_token=create_refresh_token(user_id),
                user_id=user_id,
            )
        except Exception:
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            context.set_details("Invalid refresh token")
            return lifeos_pb2.TokenPair()
