"""
Logging setup.

We log *operational* facts (request id, case id, timings, errors) but NOT the
content of user messages, because those may contain sensitive personal data.
"""
from __future__ import annotations

import logging
import sys
import time
import uuid
from contextlib import contextmanager


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        stream=sys.stdout,
        force=True,
    )
    # httpx is chatty at INFO; keep it quiet unless debugging.
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def timed(logger: logging.Logger, label: str, **context):
    """Log how long a block of code took. Usage: `with timed(log, "extract", case_id=cid): ...`"""
    start = time.perf_counter()
    ctx = " ".join(f"{k}={v}" for k, v in context.items())
    try:
        yield
        ms = (time.perf_counter() - start) * 1000
        logger.info("%s ok %s duration_ms=%.0f", label, ctx, ms)
    except Exception as exc:  # noqa: BLE001 - we re-raise after logging
        ms = (time.perf_counter() - start) * 1000
        logger.error("%s failed %s duration_ms=%.0f error=%s", label, ctx, ms, type(exc).__name__)
        raise
