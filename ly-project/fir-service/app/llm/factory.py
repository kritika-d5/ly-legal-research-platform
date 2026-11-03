"""
Builds the configured provider. The rest of the app calls `get_llm()`.
Tests call `set_llm(MockProvider(...))` to swap in a fake.
"""
from __future__ import annotations

import logging
from typing import Optional

from app.config import get_settings
from app.llm.base import LLMProvider
from app.llm.providers import GeminiProvider, MockProvider, OpenAICompatibleProvider

log = logging.getLogger(__name__)
_llm_instance: Optional[LLMProvider] = None


def build_llm_from_settings() -> LLMProvider:
    s = get_settings()
    provider = s.llm_provider
    if provider == "mock":
        return MockProvider()
    if provider == "demo":
        from app.llm.demo_provider import DemoProvider
        return DemoProvider()
    s.validate_for_llm()
    if provider == "gemini":
        return GeminiProvider(
            api_key=s.llm_api_key, model=s.resolved_model,
            temperature=s.llm_temperature, timeout=s.llm_timeout_seconds,
        )
    # groq / ollama / openai_compatible all share one implementation
    return OpenAICompatibleProvider(
        name=provider,
        base_url=s.resolved_base_url,
        api_key=s.llm_api_key,
        model=s.resolved_model,
        temperature=s.llm_temperature,
        timeout=s.llm_timeout_seconds,
    )


def get_llm() -> LLMProvider:
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = build_llm_from_settings()
        log.info("LLM provider initialised: %s model=%s", _llm_instance.name, getattr(_llm_instance, "model", "-"))
    return _llm_instance


def set_llm(provider: Optional[LLMProvider]) -> None:
    """Override the provider (used by tests / demo). Pass None to reset."""
    global _llm_instance
    _llm_instance = provider
