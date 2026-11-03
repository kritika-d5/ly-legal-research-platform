"""
Request models for the API (what the client SENDS us).

FastAPI reads the JSON body of a request, validates it against these models and
rejects malformed input with a clear 422 error before our code runs.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CreateCaseRequest(BaseModel):
    language: str = Field(default="en", description="Preferred conversation language code (e.g. 'en', 'hi').")


class MessageRequest(BaseModel):
    message: str = Field(..., description="The user's message in their own words.", max_length=8000)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("message must not be empty")
        return v.strip()


class ConfirmRequest(BaseModel):
    confirmed: bool = Field(..., description="True to confirm the summary; False to reopen for corrections.")
    note: Optional[str] = Field(default=None, max_length=2000,
                                description="Optional correction text if confirmed is False.")


class ChatMessage(BaseModel):
    role: str
    content: str
    turn: int
    created_at: Optional[str] = None
