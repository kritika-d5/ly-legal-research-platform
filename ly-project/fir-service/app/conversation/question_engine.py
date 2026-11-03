"""
QuestionEngine - decides WHAT to ask (deterministic) and HOW to say it (LLM, optional).

    CaseState -> CompletenessReport (missing, prioritised)
              -> pick the first field not yet exhausted
              -> template question (always available)
              -> optional LLM rewording, falls back to the template on any failure

The engine never asks about a field the user marked unknown/declined (those
count as resolved in the completeness rules) and never asks the same field
more than `max_repeat_per_field` times.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from pydantic import BaseModel

from app.conversation.prompts import QUESTION_SYSTEM_PROMPT, build_question_user_prompt
from app.llm.base import LLMError, LLMProvider
from app.models.case_state import AskedQuestion, CaseState, MissingInformation
from app.utils.case_text import case_context_summary
from app.validation.completeness import CompletenessReport

log = logging.getLogger(__name__)


class QuestionOut(BaseModel):
    question: str


class QuestionEngine:
    def __init__(self, llm: Optional[LLMProvider], use_llm: bool = True, max_repeat_per_field: int = 2):
        self.llm = llm
        self.use_llm = use_llm and llm is not None
        self.max_repeat = max_repeat_per_field

    # ------------------------------------------------------------ selection
    def select_target(self, state: CaseState, report: CompletenessReport) -> Optional[MissingInformation]:
        for m in report.missing:
            asked = sum(q.times_asked for q in state.asked_questions if q.field == m.field)
            if asked < self.max_repeat:
                return m
        return None

    # ------------------------------------------------------------ wording
    async def generate(self, state: CaseState, target: MissingInformation, history: List[dict]) -> str:
        template = target.suggested_question
        if not self.use_llm:
            return template
        avoid = [q.question for q in state.asked_questions[-6:]]
        prompt = build_question_user_prompt(case_context_summary(state), history, target.field,
                                            target.reason, template, avoid)
        try:
            out = await self.llm.generate_structured(QUESTION_SYSTEM_PROMPT, prompt, QuestionOut)
            q = out.question.strip()
            # Guard rails: one question, sensible length, otherwise fall back.
            if 8 <= len(q) <= 260 and q.count("?") <= 1:
                return q
            log.info("llm question rejected by guard rails; using template")
        except LLMError as exc:
            log.warning("llm question wording failed (%s); using template", type(exc).__name__)
        return template

    # ------------------------------------------------------------ bookkeeping
    @staticmethod
    def record(state: CaseState, field: str, question: str) -> None:
        for q in state.asked_questions:
            if q.field == field:
                q.times_asked += 1
                q.question = question
                q.turn = state.turn_count
                break
        else:
            state.asked_questions.append(AskedQuestion(field=field, question=question, turn=state.turn_count))
        state.questions_asked += 1

    @staticmethod
    def last_asked(state: CaseState) -> Optional[AskedQuestion]:
        if not state.asked_questions:
            return None
        return max(state.asked_questions, key=lambda q: q.turn)
