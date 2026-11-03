"""
FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload

Then open:
    http://localhost:8000/        the chat UI
    http://localhost:8000/docs    interactive API documentation (Swagger UI)
    http://localhost:8000/health  liveness check
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import routes_cases, routes_chat
from app.config import get_settings
from app.llm.base import LLMUnavailableError
from app.storage.repository import get_repository
from app.utils.logging import configure_logging

log = logging.getLogger(__name__)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs once at startup (before the first request) and once at shutdown."""
    settings = get_settings()
    configure_logging(settings.log_level)
    get_repository()  # creates the SQLite file and tables if needed
    log.info("startup provider=%s model=%s db=%s", settings.llm_provider, settings.resolved_model, settings.sqlite_path)
    if settings.llm_provider != "mock" and not settings.llm_api_key and settings.llm_provider != "ollama":
        log.warning("LLM_API_KEY is empty - the first chat message will fail. Edit your .env file.")
    yield
    log.info("shutdown")


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Part 1 of an AI-assisted FIR chatbot: conversational intake that produces a structured, "
        "legally neutral CaseState for downstream legal analysis (Part 2). Academic prototype. "
        "With PROXY_SHARED_SECRET set, only the LY app may call it and each user sees only their own "
        "cases; without it (standalone mode) there is no login - do not expose publicly with real data."
    ),
    lifespan=lifespan,
)

# CORS: browsers block a web page on one origin (e.g. localhost:3000) from calling an API on another
# (localhost:8000) unless the API explicitly allows it. Our bundled UI is same-origin, so this only
# matters if you later serve a React app separately.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_cases.router)
app.include_router(routes_chat.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "provider": settings.llm_provider, "model": settings.resolved_model}


@app.exception_handler(LLMUnavailableError)
async def llm_unavailable_handler(_: Request, exc: LLMUnavailableError):
    return JSONResponse(status_code=503, content={"error": "llm_unavailable", "detail": str(exc)})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception):
    log.exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"error": "internal_error", "detail": type(exc).__name__})


# Serve the simple frontend at "/" (must be mounted LAST so API routes take precedence).
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
