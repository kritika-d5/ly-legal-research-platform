"""
Helpers for turning messy model text into a Python dict.

LLMs sometimes wrap JSON in ```json fences, add a sentence before it, or
produce a trailing comma. We never crash on that: we try progressively more
forgiving strategies and raise a clean error if all fail.
"""
from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")


def extract_json_object(text: str) -> dict[str, Any]:
    """Return the first JSON object found in `text`. Raises ValueError if none."""
    if not text or not text.strip():
        raise ValueError("empty model output")

    candidates: list[str] = [text.strip()]

    fenced = _FENCE_RE.findall(text)
    candidates.extend(f.strip() for f in fenced)

    # Substring from first '{' to last '}'
    first, last = text.find("{"), text.rfind("}")
    if first != -1 and last > first:
        candidates.append(text[first:last + 1])

    last_error: Exception | None = None
    for cand in candidates:
        for attempt in (cand, _TRAILING_COMMA_RE.sub(r"\1", cand)):
            try:
                obj = json.loads(attempt)
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError as exc:  # keep trying
                last_error = exc
    raise ValueError(f"no valid JSON object in model output: {last_error}")
