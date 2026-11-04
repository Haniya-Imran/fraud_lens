"""FastAPI application factory.

Run from the project root:
    uvicorn backend.app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ml.explain import ExplanationError

from .api.routes import router
from .config import Settings, get_settings
from .services.model_service import ModelService, ModelUnavailableError


class BodySizeLimitMiddleware:
    """Pure-ASGI middleware that rejects request bodies larger than `max_bytes`."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            return await _too_large(send, self.max_bytes)

        # Buffer the body (bounded by max_bytes) so oversized chunked uploads are
        # rejected before the application sees them.
        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.max_bytes:
                return await _too_large(send, self.max_bytes)
            chunks.append(body)
            more = message.get("more_body", False)

        replayed = False

        async def replay_receive():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        return await self.app(scope, replay_receive, send)


async def _too_large(send, limit: int):
    body = (
        '{"error":"payload_too_large","message":"Request body exceeds the %d byte limit."}' % limit
    ).encode()
    await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": body})


def _clean_validation_errors(exc: RequestValidationError) -> list[dict]:
    out = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p != "body"]
        msg = err.get("msg", "Invalid value")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        out.append({"field": ".".join(loc) or None, "message": msg})
    return out


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.model_service.load()
        yield

    app = FastAPI(
        title="FraudLens API",
        description="Credit card fraud detection with threshold tuning, SHAP explanations and money-impact analytics.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.model_service = ModelService(settings.models_dir)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=600,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"error": "invalid_input", "message": "Some transaction fields are missing or invalid.", "details": _clean_validation_errors(exc)},
        )

    @app.exception_handler(ModelUnavailableError)
    async def _unavailable(_: Request, exc: ModelUnavailableError):
        return JSONResponse(status_code=503, content={"error": "model_unavailable", "message": str(exc)})

    @app.exception_handler(ExplanationError)
    async def _explain(_: Request, exc: ExplanationError):
        logging.getLogger("fraudlens.api").error("Explanation failed: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": "explanation_failed", "message": "The explanation for this prediction could not be generated reliably, so no result is shown."},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"error": "http_error", "message": str(exc.detail)})

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        logging.getLogger("fraudlens.api").exception("Unhandled error")
        return JSONResponse(status_code=500, content={"error": "internal_error", "message": "Something went wrong on the server."})

    app.include_router(router)
    return app


app = create_app()
