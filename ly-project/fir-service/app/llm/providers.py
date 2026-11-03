"""
Concrete LLM providers.

* OpenAICompatibleProvider - Groq (free tier), Ollama (local), OpenRouter, LM Studio ...
  All of these expose the same HTTP shape:  POST {base_url}/chat/completions
* GeminiProvider - Google AI Studio free tier (different HTTP shape).
* MockProvider   - no network; returns scripted or empty JSON. Used by tests and the offline demo.

WHAT IS AN API KEY?
-------------------
A secret string that identifies YOUR account to the vendor. It goes in the
HTTP `Authorization` header. We read it from the LLM_API_KEY environment
variable and never write it in code or commit it to git.

WHAT IS TEMPERATURE?
--------------------
A number controlling randomness. 0 makes answers repeatable, which is what we
want for fact extraction. Higher values (0.7+) are for creative writing.
"""
from __future__ import annotations

import json
import logging
from typing import Callable, Optional

import httpx

from app.llm.base import LLMProvider, LLMUnavailableError

log = logging.getLogger(__name__)


class OpenAICompatibleProvider(LLMProvider):
    """Works with any server that implements the OpenAI Chat Completions API."""

    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.0,
        timeout: float = 60.0,
        supports_json_mode: bool = True,
    ):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.timeout = timeout
        self.supports_json_mode = supports_json_mode

    async def generate_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body: dict = {
            "model": self.model,
            "temperature": self.temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if json_mode and self.supports_json_mode:
            body["response_format"] = {"type": "json_object"}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise LLMUnavailableError(f"{self.name}: request timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(f"{self.name}: network error: {exc}") from exc

        if resp.status_code == 429:
            raise LLMUnavailableError(f"{self.name}: rate limited (HTTP 429). Wait a minute and retry.")
        if resp.status_code in (401, 403):
            raise LLMUnavailableError(f"{self.name}: authentication failed (HTTP {resp.status_code}). Check LLM_API_KEY.")
        if resp.status_code >= 400:
            # Some servers reject response_format; retry once without it.
            if json_mode and self.supports_json_mode and "response_format" in resp.text:
                log.warning("%s rejected json_mode; retrying without response_format", self.name)
                self.supports_json_mode = False
                return await self.generate_text(system_prompt, user_prompt, json_mode=json_mode)
            raise LLMUnavailableError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:300]}")

        try:
            data = resp.json()
            return data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMUnavailableError(f"{self.name}: unexpected response shape: {resp.text[:300]}") from exc


class GeminiProvider(LLMProvider):
    """Google AI Studio (Gemini) REST API - free tier available."""

    name = "gemini"

    def __init__(self, *, api_key: str, model: str, temperature: float = 0.0, timeout: float = 60.0):
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.timeout = timeout
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    async def generate_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False) -> str:
        url = f"{self.base_url}/models/{self.model}:generateContent"
        body: dict = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {"temperature": self.temperature},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, params={"key": self.api_key}, json=body)
        except httpx.TimeoutException as exc:
            raise LLMUnavailableError(f"gemini: request timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(f"gemini: network error: {exc}") from exc

        if resp.status_code == 429:
            raise LLMUnavailableError("gemini: rate limited (HTTP 429). Wait a minute and retry.")
        if resp.status_code in (400, 401, 403) and "API key" in resp.text:
            raise LLMUnavailableError("gemini: invalid API key. Check LLM_API_KEY.")
        if resp.status_code >= 400:
            raise LLMUnavailableError(f"gemini: HTTP {resp.status_code}: {resp.text[:300]}")
        try:
            data = resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMUnavailableError(f"gemini: unexpected response shape: {resp.text[:300]}") from exc


class MockProvider(LLMProvider):
    """
    Offline provider for tests and demos.

    `responder` is an optional function (system_prompt, user_prompt) -> str.
    If not given, the mock returns an *empty* extraction ("{}"), which is the
    honest answer of a model that found nothing - useful for testing that the
    system never invents facts.
    """

    name = "mock"

    def __init__(self, responder: Optional[Callable[[str, str], str]] = None):
        self.responder = responder
        self.calls: list[dict] = []

    async def generate_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False) -> str:
        self.calls.append({"system": system_prompt, "user": user_prompt, "json_mode": json_mode})
        if self.responder is not None:
            out = self.responder(system_prompt, user_prompt)
            return out if isinstance(out, str) else json.dumps(out)
        return "{}"
