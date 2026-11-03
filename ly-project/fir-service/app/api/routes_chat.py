"""
Chat endpoint: POST /cases/{case_id}/messages

This is the heart of the API. One call = one conversational turn:
the user's text goes in, the assistant's reply + updated CaseState come out.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_manager
from app.conversation.manager import ConversationManager
from app.models.messages import MessageRequest
from app.models.responses import MessageResponse
from app.storage.repository import CaseNotFoundError
from app.utils.logging import new_request_id

log = logging.getLogger(__name__)
router = APIRouter(prefix="/cases", tags=["chat"])


@router.post("/{case_id}/messages", response_model=MessageResponse, summary="Send a message in the conversation")
async def post_message(case_id: str, body: MessageRequest, manager: ConversationManager = Depends(get_manager)):
    request_id = new_request_id()
    log.info("request_id=%s case_id=%s message_chars=%d", request_id, case_id, len(body.message))
    try:
        result = await manager.handle_message(case_id, body.message)
    except CaseNotFoundError:
        raise HTTPException(status_code=404, detail=f"case '{case_id}' not found")
    state = result.state
    return MessageResponse(
        case_id=state.case_id,
        assistant_message=result.assistant_message,
        next_action=result.next_action,  # type: ignore[arg-type]
        status=state.status.value,
        completeness=result.completeness,
        open_contradictions=state.open_contradictions(),
        changes=result.changes,
        progress=manager.progress(state),
        case_state=state,
        warning=result.warning,
    )
