"""
Dependency wiring for the API: one ConversationManager shared by all routes,
and `get_caller` / `require_access`, which decide whose cases a request may see.
Tests call `reset_manager()` after swapping in a mock LLM / in-memory repository.
"""
from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException

from app.config import get_settings
from app.conversation.manager import ConversationManager
from app.llm.factory import get_llm
from app.storage.repository import CaseNotFoundError, get_repository

_manager: Optional[ConversationManager] = None


def get_manager() -> ConversationManager:
    global _manager
    if _manager is None:
        _manager = ConversationManager(get_repository(), get_llm(), get_settings())
    return _manager


def reset_manager() -> None:
    global _manager
    _manager = None


# ---------------------------------------------------------------- who is asking
@dataclass(frozen=True)
class Caller:
    """The account a request is made on behalf of. `user_id is None` means
    standalone mode: no accounts, every case visible (Part 1 behaviour)."""
    user_id: Optional[str]


def get_caller(
    x_proxy_secret: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
) -> Caller:
    """
    Decide whose request this is.

    The browser never talks to this service directly - the LY Express server
    does, after checking the login cookie. It proves it is the LY server with
    a shared secret and says which user is logged in with X-User-Id. Without
    the secret check, anyone who could reach port 8000 could send any
    X-User-Id and read other people's FIRs.
    """
    secret = get_settings().proxy_shared_secret
    if not secret:
        return Caller(user_id=None)
    # compare_digest takes the same time however many characters match, so the
    # secret cannot be guessed one character at a time from response timings.
    if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret.encode(), secret.encode()):
        raise HTTPException(status_code=401, detail="This service only accepts requests from the LY app.")
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Please log in to use the FIR Assistant.")
    return Caller(user_id=x_user_id)


def require_access(manager: ConversationManager, case_id: str, caller: Caller) -> None:
    """404 - not 403 - for someone else's case, so case ids cannot be probed
    to find out which ones exist."""
    try:
        owner = manager.repo.get_owner(case_id)
    except CaseNotFoundError:
        raise HTTPException(status_code=404, detail=f"case '{case_id}' not found")
    if caller.user_id is not None and owner != caller.user_id:
        raise HTTPException(status_code=404, detail=f"case '{case_id}' not found")
