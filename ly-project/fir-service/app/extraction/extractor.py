"""
FactExtractor - turns one user message into an `ExtractedFacts` object.

    extractor = FactExtractor(llm)
    facts = await extractor.extract(user_message, case_state, history, last_question)

It never touches the CaseState directly; the merger does that. Keeping the two
apart is what lets us test merging without any LLM, and swap models freely.
"""
from __future__ import annotations

import logging
from typing import Optional

from app.extraction.prompts import EXTRACTION_SYSTEM_PROMPT, build_extraction_user_prompt
from app.extraction.schemas import ExtractedFacts
from app.llm.base import LLMProvider
from app.models.case_state import CaseState
from app.utils.case_text import case_context_summary
from app.utils.logging import timed

log = logging.getLogger(__name__)


class FactExtractor:
    def __init__(self, llm: LLMProvider):
        self.llm = llm

    async def extract(
        self,
        user_message: str,
        state: CaseState,
        history: list[dict],
        last_question: Optional[str],
    ) -> ExtractedFacts:
        """
        Raises LLMUnavailableError / StructuredOutputError; the conversation
        manager decides how to degrade gracefully.
        """
        prompt = build_extraction_user_prompt(
            user_message=user_message,
            conversation_history=history,
            case_context_summary=case_context_summary(state),
            last_question=last_question,
        )
        with timed(log, "extract_facts", case_id=state.case_id, turn=state.turn_count):
            facts = await self.llm.generate_structured(EXTRACTION_SYSTEM_PROMPT, prompt, ExtractedFacts)
        log.debug("extraction sections: accused=%d acts=%d unknown=%s declined=%s corrections=%d",
                  len(facts.accused), len(facts.acts), facts.unknown_fields, facts.declined_fields,
                  len(facts.corrections))
        return facts
