"""
Response models for the API (what we SEND back). Documented in docs/API.md.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.models.case_state import CaseState, Contradiction
from app.models.messages import ChatMessage
from app.validation.completeness import CompletenessReport

NextAction = Literal["ask_question", "clarify_contradiction", "review_summary", "complete", "error"]


class CaseCreatedResponse(BaseModel):
    case_id: str
    assistant_message: str
    status: str
    disclaimer: str


class ProgressItem(BaseModel):
    """Compact checklist entry for the frontend side panel."""

    label: str
    status: Literal["done", "missing", "unknown", "not_applicable"]
    detail: Optional[str] = None


class MessageResponse(BaseModel):
    case_id: str
    assistant_message: str
    next_action: NextAction
    status: str
    completeness: CompletenessReport
    open_contradictions: List[Contradiction] = Field(default_factory=list)
    changes: List[str] = Field(default_factory=list, description="What the system learned from this message.")
    progress: List[ProgressItem] = Field(default_factory=list)
    case_state: CaseState
    warning: Optional[str] = Field(default=None, description="Set when the LLM was unavailable and a fallback was used.")


class CaseStateResponse(BaseModel):
    case_state: CaseState


class CaseDetailResponse(BaseModel):
    case_id: str
    status: str
    created_at: str
    updated_at: str
    messages: List[ChatMessage]
    completeness: CompletenessReport
    progress: List[ProgressItem]
    case_state: CaseState


class SummaryResponse(BaseModel):
    case_id: str
    status: str
    summary: str
    open_contradictions: List[Contradiction] = Field(default_factory=list)
    completeness: CompletenessReport


class ConfirmResponse(BaseModel):
    case_id: str
    status: str
    user_confirmed: bool
    assistant_message: str
    case_state: CaseState


class CaseListItem(BaseModel):
    case_id: str
    created_at: str
    updated_at: str
    status: str


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
