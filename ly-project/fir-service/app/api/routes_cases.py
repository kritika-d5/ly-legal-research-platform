"""
Case endpoints (everything except sending a chat message).

WHAT IS A REST API?
-------------------
A set of URLs ("endpoints") that a client (our web page, a test, another
program) calls over HTTP. GET reads data, POST creates or triggers something.
Requests and responses carry JSON. FastAPI turns each Python function below
into one endpoint and auto-generates interactive docs at /docs.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_manager
from app.conversation.manager import DISCLAIMER, ConversationManager
from app.llm.base import LLMError
from app.models.messages import ChatMessage, ConfirmRequest, CreateCaseRequest
from app.models.responses import (
    CaseCreatedResponse, CaseDetailResponse, CaseListItem, CaseStateResponse,
    ConfirmResponse, SummaryResponse,
)
from app.storage.repository import CaseNotFoundError
from app.validation.completeness import CompletenessReport, check_completeness

log = logging.getLogger(__name__)
router = APIRouter(prefix="/cases", tags=["cases"])


def _load(manager: ConversationManager, case_id: str):
    try:
        return manager.repo.get_state(case_id)
    except CaseNotFoundError:
        raise HTTPException(status_code=404, detail=f"case '{case_id}' not found")


@router.post("", response_model=CaseCreatedResponse, status_code=201, summary="Start a new case")
def create_case(body: CreateCaseRequest | None = None, manager: ConversationManager = Depends(get_manager)):
    language = body.language if body else "en"
    state, intro = manager.create_case(language)
    return CaseCreatedResponse(case_id=state.case_id, assistant_message=intro,
                               status=state.status.value, disclaimer=DISCLAIMER)


@router.get("", response_model=list[CaseListItem], summary="List recent cases")
def list_cases(limit: int = 50, manager: ConversationManager = Depends(get_manager)):
    return [CaseListItem(**row) for row in manager.repo.list_cases(limit)]


@router.get("/{case_id}", response_model=CaseDetailResponse, summary="Case overview + transcript")
def get_case(case_id: str, manager: ConversationManager = Depends(get_manager)):
    state = _load(manager, case_id)
    report = check_completeness(state, manager.settings.max_repeat_per_field)
    messages = [ChatMessage(**m) for m in manager.repo.get_messages(case_id)]
    return CaseDetailResponse(case_id=state.case_id, status=state.status.value, created_at=state.created_at,
                              updated_at=state.updated_at, messages=messages, completeness=report,
                              progress=manager.progress(state), case_state=state)


@router.get("/{case_id}/state", response_model=CaseStateResponse, summary="The full CaseState JSON (Part 2 input)")
def get_state(case_id: str, manager: ConversationManager = Depends(get_manager)):
    return CaseStateResponse(case_state=_load(manager, case_id))


@router.get("/{case_id}/messages", response_model=list[ChatMessage], summary="Transcript only")
def get_messages(case_id: str, manager: ConversationManager = Depends(get_manager)):
    _load(manager, case_id)
    return [ChatMessage(**m) for m in manager.repo.get_messages(case_id)]


@router.get("/{case_id}/completeness", response_model=CompletenessReport, summary="What is still missing")
def get_completeness(case_id: str, manager: ConversationManager = Depends(get_manager)):
    state = _load(manager, case_id)
    return check_completeness(state, manager.settings.max_repeat_per_field)


@router.get("/{case_id}/summary", response_model=SummaryResponse, summary="Human-readable review summary")
async def get_summary(case_id: str, manager: ConversationManager = Depends(get_manager)):
    _load(manager, case_id)
    try:
        state, summary = await manager.get_summary(case_id)
    except LLMError as exc:  # summary polish already falls back, but be defensive
        raise HTTPException(status_code=503, detail=str(exc))
    return SummaryResponse(case_id=state.case_id, status=state.status.value, summary=summary,
                           open_contradictions=state.open_contradictions(),
                           completeness=check_completeness(state, manager.settings.max_repeat_per_field))


@router.post("/{case_id}/confirm", response_model=ConfirmResponse, summary="Confirm (or reopen) the case")
async def confirm_case(case_id: str, body: ConfirmRequest, manager: ConversationManager = Depends(get_manager)):
    _load(manager, case_id)
    try:
        state, message = await manager.confirm(case_id, body.confirmed, body.note)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return ConfirmResponse(case_id=state.case_id, status=state.status.value, user_confirmed=state.user_confirmed,
                           assistant_message=message, case_state=state)
