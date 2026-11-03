"""
Shared pytest fixtures.

WHAT IS PYTEST?
---------------
A test runner. Any function named test_* in a file named test_*.py is run;
`assert` statements decide pass/fail. Fixtures (functions decorated with
@pytest.fixture) build reusable test objects such as a fake LLM.

All tests here run WITHOUT a real LLM (MockProvider), so they are fast, free
and deterministic. tests/test_live_llm.py is the exception and skips itself
when no API key is configured.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Callable

import pytest

from app.config import Settings
from app.conversation.manager import ConversationManager
from app.extraction.prompts import EXTRACTION_SYSTEM_PROMPT
from app.llm.providers import MockProvider
from app.storage.repository import SQLiteRepository

REF_DATE = date(2026, 9, 9)


def latest_user_message(prompt: str) -> str:
    """Pull the user's message back out of the extraction prompt (for scripted mocks)."""
    marker = "=== USER'S LATEST MESSAGE (extract from THIS) ==="
    if marker not in prompt:
        return ""
    return prompt.split(marker)[1].split("=== OUTPUT FORMAT ===")[0].strip()


def scripted_provider(script: dict[str, dict]) -> MockProvider:
    """A mock LLM that answers extraction prompts from a {message_prefix: extraction_json} table."""
    def responder(system: str, user: str) -> str:
        if system != EXTRACTION_SYSTEM_PROMPT:
            return "{}"
        msg = latest_user_message(user)
        for prefix, payload in script.items():
            if msg.lower().startswith(prefix.lower()):
                return json.dumps(payload)
        return "{}"
    return MockProvider(responder)


@pytest.fixture
def settings() -> Settings:
    return Settings(llm_provider="mock", llm_question_wording=False, llm_contradiction_check=False,
                    database_url="sqlite:///:memory:", llm_api_key="")


@pytest.fixture
def repo() -> SQLiteRepository:
    return SQLiteRepository(":memory:")


@pytest.fixture
def make_manager(settings, repo) -> Callable[..., ConversationManager]:
    def _make(script: dict | None = None, provider: MockProvider | None = None) -> ConversationManager:
        llm = provider or scripted_provider(script or {})
        return ConversationManager(repo, llm, settings)
    return _make
