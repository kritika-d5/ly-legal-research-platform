"""
Dependency wiring for the API: one ConversationManager shared by all routes.
Tests call `reset_manager()` after swapping in a mock LLM / in-memory repository.
"""
from __future__ import annotations

from typing import Optional

from app.config import get_settings
from app.conversation.manager import ConversationManager
from app.llm.factory import get_llm
from app.storage.repository import get_repository

_manager: Optional[ConversationManager] = None


def get_manager() -> ConversationManager:
    global _manager
    if _manager is None:
        _manager = ConversationManager(get_repository(), get_llm(), get_settings())
    return _manager


def reset_manager() -> None:
    global _manager
    _manager = None
