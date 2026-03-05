"""gRPC server with JWT auth interceptor."""

import asyncio
import logging
import signal

import grpc
from grpc import aio

from app.auth import decode_token
from app.db import init_db

from gen import lifeos_pb2_grpc

from app.services.auth_service import AuthServicer
from app.services.task_service import TaskServicer
from app.services.hydration_service import HydrationServicer
from app.services.partner_service import PartnerServicer
from app.services.sleep_service import SleepServicer
from app.services.ai_service import AiServicer
from app.services.sync_service import SyncServicer
from app.services.health_service import HealthServicer
from app.services.automation_service import AutomationServicer, automation_cron_loop
from app.services.apikey_service import ApiKeyServicer
from app.services.webhook_service import WebhookServicer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lifeos")

# Routes that don't require authentication
PUBLIC_METHODS = {
    "/lifeos.AuthService/Register",
    "/lifeos.AuthService/Login",
    "/lifeos.AuthService/Refresh",
    "/lifeos.HealthService/Check",
    "/lifeos.WebhookService/Command",    # API-key auth, not JWT
}


class AuthInterceptor(aio.ServerInterceptor):
    """Extracts JWT from metadata and sets context.user_id for authenticated routes."""

    async def intercept_service(self, continuation, handler_call_details):
        method = handler_call_details.method

        # Skip auth for public routes
        if method in PUBLIC_METHODS:
            return await continuation(handler_call_details)

        # Extract token from metadata
        metadata = dict(handler_call_details.invocation_metadata or [])
        auth_header = metadata.get("authorization", "")

        if not auth_header.startswith("Bearer "):
            # Return an error handler
            return _unauthenticated_handler(handler_call_details)

        token = auth_header[7:]
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                return _unauthenticated_handler(handler_call_details)

            # Store user_id so services can access it via context.user_id
            handler_call_details.user_id = payload["sub"]
        except Exception:
            return _unauthenticated_handler(handler_call_details)

        return await continuation(handler_call_details)


def _unauthenticated_handler(handler_call_details):
    """Returns a handler that immediately fails with UNAUTHENTICATED."""

    async def _unary_unary(request, context):
        context.set_code(grpc.StatusCode.UNAUTHENTICATED)
        context.set_details("Valid authentication required")
        return None

    return grpc.unary_unary_rpc_method_handler(_unary_unary)


class AuthContext:
    """Wraps gRPC context to add user_id from interceptor."""

    def __init__(self, context, user_id):
        self._context = context
        self.user_id = user_id

    def __getattr__(self, name):
        return getattr(self._context, name)


class AuthServicerWrapper:
    """Wraps a servicer to inject user_id from metadata into context."""

    def __init__(self, servicer):
        self._servicer = servicer

    def __getattr__(self, name):
        attr = getattr(self._servicer, name)
        if callable(attr):

            async def wrapper(request, context):
                # Extract user_id from metadata
                metadata = dict(context.invocation_metadata() or [])
                auth_header = metadata.get("authorization", "")
                user_id = None
                if auth_header.startswith("Bearer "):
                    try:
                        payload = decode_token(auth_header[7:])
                        user_id = payload.get("sub")
                    except Exception:
                        pass
                auth_ctx = AuthContext(context, user_id)
                return await attr(request, auth_ctx)

            return wrapper
        return attr


async def serve():
    """Start the gRPC server."""
    logger.info("Initializing database...")
    await init_db()

    server = aio.server()

    # Register all services (wrapped with auth context injection)
    lifeos_pb2_grpc.add_AuthServiceServicer_to_server(
        AuthServicerWrapper(AuthServicer()), server
    )
    lifeos_pb2_grpc.add_TaskServiceServicer_to_server(
        AuthServicerWrapper(TaskServicer()), server
    )
    lifeos_pb2_grpc.add_HydrationServiceServicer_to_server(
        AuthServicerWrapper(HydrationServicer()), server
    )
    lifeos_pb2_grpc.add_PartnerServiceServicer_to_server(
        AuthServicerWrapper(PartnerServicer()), server
    )
    lifeos_pb2_grpc.add_SleepServiceServicer_to_server(
        AuthServicerWrapper(SleepServicer()), server
    )
    lifeos_pb2_grpc.add_AiServiceServicer_to_server(
        AuthServicerWrapper(AiServicer()), server
    )
    lifeos_pb2_grpc.add_SyncServiceServicer_to_server(
        AuthServicerWrapper(SyncServicer()), server
    )
    lifeos_pb2_grpc.add_HealthServiceServicer_to_server(
        AuthServicerWrapper(HealthServicer()), server
    )
    lifeos_pb2_grpc.add_AutomationServiceServicer_to_server(
        AuthServicerWrapper(AutomationServicer()), server
    )
    lifeos_pb2_grpc.add_ApiKeyServiceServicer_to_server(
        AuthServicerWrapper(ApiKeyServicer()), server
    )
    lifeos_pb2_grpc.add_WebhookServiceServicer_to_server(
        AuthServicerWrapper(WebhookServicer()), server
    )

    # Enable reflection for debugging with grpcurl
    from grpc_reflection.v1alpha import reflection
    from gen import lifeos_pb2

    SERVICE_NAMES = (
        lifeos_pb2.DESCRIPTOR.services_by_name["AuthService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["TaskService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["HydrationService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["PartnerService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["SleepService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["AiService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["SyncService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["HealthService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["AutomationService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["ApiKeyService"].full_name,
        lifeos_pb2.DESCRIPTOR.services_by_name["WebhookService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(SERVICE_NAMES, server)

    listen_addr = "0.0.0.0:50051"
    server.add_insecure_port(listen_addr)
    logger.info(f"LifeOS gRPC server listening on {listen_addr}")
    await server.start()

    # Start automation cron scheduler
    cron_task = asyncio.create_task(automation_cron_loop())

    # Graceful shutdown
    loop = asyncio.get_event_loop()
    stop_event = asyncio.Event()

    def _signal_handler():
        logger.info("Shutdown signal received")
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    await stop_event.wait()
    logger.info("Shutting down server...")
    cron_task.cancel()
    await server.stop(grace=5)


def main():
    asyncio.run(serve())


if __name__ == "__main__":
    main()
