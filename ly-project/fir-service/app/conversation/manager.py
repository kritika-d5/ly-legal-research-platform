"""
ConversationManager - the orchestrator that connects everything.

    user message
        -> FactExtractor      (LLM)         what did the user just tell us?
        -> FactMerger         (rules)       fold it into the CaseState
        -> ContradictionDetector (rules+LLM) does it clash with earlier facts?
        -> CompletenessChecker (rules)      what is still missing?
        -> QuestionEngine     (rules+LLM)   what do we ask next?
        -> Repository         (SQLite)      save state + transcript

It also runs the final review: summary -> user confirmation -> COMPLETE.

Graceful degradation: if the LLM is down, the user still gets a sensible
reply (template question + a warning) and nothing is lost; they can retry.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Set

from app.config import Settings, get_settings
from app.conversation.question_engine import QuestionEngine
from app.conversation.summary import build_summary, polish_summary
from app.extraction.extractor import FactExtractor
from app.extraction.merger import merge_facts
from app.extraction.schemas import (
    ExtractedFacts, ExtractedInjury, ExtractedProperty, ExtractedWeapon,
)
from app.llm.base import LLMError, LLMProvider, LLMUnavailableError, StructuredOutputError
from app.models.case_state import CaseState, CaseStatus, Fact, FactStatus
from app.models.responses import ProgressItem
from app.storage.repository import Repository
from app.utils.text import is_decline, is_dont_know, looks_like_confirmation, yes_no
from app.validation.completeness import CompletenessReport, check_completeness
from app.validation.contradictions import ContradictionDetector, clarification_question
from app.validation.validators import validate_case_state

log = logging.getLogger(__name__)

INTRO_MESSAGE = (
    "Hello. I can help you document the facts of an incident and organise the information "
    "needed to prepare an FIR draft. I will ask follow-up questions where important details "
    "are missing. I do not give legal advice or decide who is at fault - I only record what you tell me.\n\n"
    "Please describe what happened, in your own words."
)
DISCLAIMER = (
    "Academic prototype. This assistant organises information you provide; it does not determine guilt, "
    "does not replace the police or a lawyer, and any legal classification must be independently verified "
    "before official submission."
)
LLM_DOWN_WARNING = (
    "The language model is temporarily unavailable, so I could not fully process your last message. "
    "Your message has been saved. You can retry by sending it again, or continue answering."
)

# Which extraction field a "don't know" / "yes/no" answer refers to, per question field.
_UNKNOWN_TARGET = {
    "accused.presence": "accused.name", "accused.identity": "accused.name", "accused.description": "accused.description",
    "accused.relationship_to_complainant": "accused.relationship_to_complainant",
    "accused.address_or_whereabouts": "accused.address_or_whereabouts",
    "incident.date": "incident.date", "incident.time": "incident.time", "incident.location": "incident.location",
    "incident.location_details": "incident.location_details",
    "injury.details": "injury.type", "injury.hospital_or_doctor": "injury.hospital_or_doctor",
    "weapon.object": "weapon.object", "property.item": "property.item",
    "property.approximate_value": "property.approximate_value", "witness.name": "witness.name",
    "witness.what_witnessed": "witness.what_witnessed", "evidence.description": "evidence.description",
    "complainant.name": "complainant.name", "complainant.contact": "complainant.contact", "victim.name": "victim.name",
    "flags.injury_occurred": "flags.injury_occurred", "flags.weapon_involved": "flags.weapon_involved",
    "flags.property_involved": "flags.property_involved", "flags.witnesses_present": "flags.witnesses_present",
    "flags.evidence_available": "flags.evidence_available", "flags.police_informed_earlier": "flags.police_informed_earlier",
    "property.recovered": "property.recovered", "property.force_or_threat_used": "property.force_or_threat_used",
    "injury.treatment_received": "injury.treatment_received", "injury.medical_report_available": "injury.medical_report_available",
    "incident.ongoing_or_repeated": "incident.ongoing_or_repeated",
}


@dataclass
class TurnResult:
    state: CaseState
    assistant_message: str
    next_action: str
    completeness: CompletenessReport
    changes: List[str] = field(default_factory=list)
    warning: Optional[str] = None


class ConversationManager:
    def __init__(self, repo: Repository, llm: Optional[LLMProvider], settings: Optional[Settings] = None):
        self.repo = repo
        self.llm = llm
        self.settings = settings or get_settings()
        self.extractor = FactExtractor(llm) if llm else None
        self.detector = ContradictionDetector(llm, self.settings.llm_contradiction_check)
        self.questions = QuestionEngine(llm, self.settings.llm_question_wording, self.settings.max_repeat_per_field)

    # ------------------------------------------------------------------ create
    def create_case(self, language: str = "en", owner_id: Optional[str] = None) -> tuple[CaseState, str]:
        state = CaseState(language=language)
        self.repo.create_case(state, owner_id)
        self.repo.add_message(state.case_id, "assistant", INTRO_MESSAGE, 0)
        log.info("case created case_id=%s", state.case_id)
        return state, INTRO_MESSAGE

    # ----------------------------------------------------------------- message
    async def handle_message(self, case_id: str, text: str) -> TurnResult:
        state = self.repo.get_state(case_id)
        text = (text or "").strip()
        if not text:
            report = self._refresh_completeness(state)
            return TurnResult(state, "Please type your message - I did not receive any text.", "ask_question", report)

        if state.status == CaseStatus.COMPLETE:
            report = self._refresh_completeness(state)
            return TurnResult(state, "This case has already been confirmed and closed. Please start a new case "
                                     "if you want to report something else.", "complete", report)

        state.turn_count += 1
        turn = state.turn_count
        self.repo.add_message(case_id, "user", text, turn)
        history = self.repo.get_messages(case_id)
        last_q = self.questions.last_asked(state)
        last_q_text = last_q.question if last_q else None
        pending = next((c for c in state.contradictions if c.contradiction_id == state.pending_clarification), None)
        if pending:
            last_q_text = clarification_question(pending)

        # ---- 1. extract
        warning: Optional[str] = None
        facts = ExtractedFacts()
        if self.extractor is not None:
            try:
                facts = await self.extractor.extract(text, state, history[:-1], last_q_text)
            except LLMUnavailableError as exc:
                log.warning("extraction unavailable case=%s: %s", case_id, exc)
                warning = LLM_DOWN_WARNING
            except StructuredOutputError as exc:
                log.warning("extraction malformed case=%s: %s", case_id, exc)
                warning = ("I had trouble understanding the structure of that message. I have saved it; "
                           "could you rephrase or add a little more detail?")
        self._apply_short_answer_fallbacks(state, facts, text, last_q.field if last_q else None)

        # ---- 2. merge
        correction_fields: Set[str] = {pending.field} if pending else set()
        if pending and pending.field == "accused.identity":
            correction_fields.add("accused.name")
        reference_date = datetime.fromisoformat(state.created_at).date()
        merged = merge_facts(state, facts, turn, reference_date, correction_fields)

        if pending:
            self.detector.resolve(state, pending.contradiction_id, text)
            state.pending_clarification = None

        # ---- 3. review-stage handling (user is reacting to the summary)
        if state.status == CaseStatus.AWAITING_CONFIRMATION:
            confirms = facts.user_intent == "confirm" or looks_like_confirmation(text)
            if confirms and not merged.changes and not merged.conflicts:
                return self._finalise(state, turn)
            state.status = CaseStatus.IN_PROGRESS  # corrections/additions reopen the case
            state.final_summary = state.final_summary or ""

        # ---- 4. contradictions
        new_contradictions = self.detector.from_conflicts(state, merged.conflicts)
        if not new_contradictions and warning is None:
            new_contradictions = await self.detector.llm_check(state, text, history)

        # ---- 5. completeness
        report = self._refresh_completeness(state)

        # ---- 6. decide what to say next
        open_c = state.open_contradictions()
        if open_c:
            c = open_c[0]
            reply = clarification_question(c)
            state.pending_clarification = c.contradiction_id
            self.questions.record(state, f"clarify.{c.field}", reply)
            next_action = "clarify_contradiction"
        elif merged.ambiguities and not any(q.field == "clarify.ambiguity" and q.turn == turn for q in state.asked_questions) \
                and sum(1 for q in state.asked_questions if q.field == "clarify.ambiguity") < 2:
            reply = (f"Just so I record this correctly: {merged.ambiguities[0].rstrip('.')}. "
                     f"Could you tell me exactly who or what you mean?")
            self.questions.record(state, "clarify.ambiguity", reply)
            next_action = "ask_question"
        elif report.complete or state.questions_asked >= self.settings.max_follow_up_questions:
            had_summary = bool(state.final_summary)
            reply = await self._start_review(state)
            if merged.changes and had_summary:
                reply = "Noted - I have updated: " + "; ".join(merged.changes[:4]) + ".\n\n" + reply
            next_action = "review_summary"
        else:
            target = self.questions.select_target(state, report)
            if target is None:
                reply = await self._start_review(state)
                next_action = "review_summary"
            else:
                question = await self.questions.generate(state, target, history)
                self.questions.record(state, target.field, question)
                reply = question if (self.questions.use_llm and warning is None) else self._ack(turn) + question
                next_action = "ask_question"

        if warning:
            reply = f"{warning}\n\n{reply}"

        # ---- 7. persist
        problems = validate_case_state(state)
        if problems:
            log.error("case state validation problems case=%s: %s", case_id, problems)
        self.repo.save_state(state)
        self.repo.add_message(case_id, "assistant", reply, turn)
        log.info("turn processed case=%s turn=%d next=%s changes=%d contradictions_open=%d completion=%d%%",
                 case_id, turn, next_action, len(merged.changes), len(open_c), report.completion_percentage)
        return TurnResult(state, reply, next_action, report, merged.changes, warning)

    # ----------------------------------------------------------------- review
    async def _start_review(self, state: CaseState) -> str:
        draft = build_summary(state)
        summary = await polish_summary(self.llm, draft, enabled=self.settings.llm_question_wording)
        state.final_summary = summary
        state.status = CaseStatus.AWAITING_CONFIRMATION
        return summary

    async def get_summary(self, case_id: str) -> tuple[CaseState, str]:
        state = self.repo.get_state(case_id)
        self._refresh_completeness(state)
        draft = build_summary(state)
        summary = await polish_summary(self.llm, draft, enabled=self.settings.llm_question_wording)
        return state, summary

    async def confirm(self, case_id: str, confirmed: bool, note: Optional[str] = None) -> tuple[CaseState, str]:
        state = self.repo.get_state(case_id)
        if state.status == CaseStatus.COMPLETE:
            return state, "This case is already confirmed."
        if not confirmed:
            state.status = CaseStatus.IN_PROGRESS
            self.repo.save_state(state)
            if note:
                result = await self.handle_message(case_id, note)
                return result.state, result.assistant_message
            return state, "Okay - tell me what needs to be corrected or added."
        if state.open_contradictions():
            c = state.open_contradictions()[0]
            state.pending_clarification = c.contradiction_id
            self.repo.save_state(state)
            return state, ("Before confirming, one point still needs clarification. " + clarification_question(c))
        result = self._finalise(state, state.turn_count)
        return result.state, result.assistant_message

    def _finalise(self, state: CaseState, turn: int) -> TurnResult:
        self._mark_confirmed(state)
        state.user_confirmed = True
        state.status = CaseStatus.COMPLETE
        if not state.final_summary:
            state.final_summary = build_summary(state)
        report = self._refresh_completeness(state)
        problems = validate_case_state(state)
        if problems:
            log.error("final case state invalid case=%s: %s", state.case_id, problems)
        self.repo.save_state(state)
        reply = ("Thank you. I have recorded your confirmation. The information has been saved as a structured "
                 "case record and can now be passed on for legal review. Please remember to review the final "
                 "document carefully before any official submission.")
        self.repo.add_message(state.case_id, "assistant", reply, turn)
        log.info("case confirmed case_id=%s completion=%d%%", state.case_id, report.completion_percentage)
        return TurnResult(state, reply, "complete", report)

    @staticmethod
    def _mark_confirmed(state: CaseState) -> None:
        """After the user confirms the summary, system-extracted facts become user-confirmed."""
        def walk(obj):
            if isinstance(obj, Fact):
                if obj.status in (FactStatus.EXTRACTED, FactStatus.EXPLICIT) and obj.has_value:
                    obj.status = FactStatus.CONFIRMED
                return
            if hasattr(obj, "model_fields"):
                for name in type(obj).model_fields:
                    walk(getattr(obj, name))
            elif isinstance(obj, list):
                for item in obj:
                    walk(item)
        walk(state)

    # ---------------------------------------------------------------- helpers
    def _refresh_completeness(self, state: CaseState) -> CompletenessReport:
        report = check_completeness(state, self.settings.max_repeat_per_field)
        state.missing_information = report.missing
        state.completion_percentage = report.completion_percentage
        return report

    @staticmethod
    def _ack(turn: int) -> str:
        return "Thank you for sharing that. " if turn == 1 else "Thank you. "

    @staticmethod
    def _apply_short_answer_fallbacks(state: CaseState, facts: ExtractedFacts, text: str, asked_field: Optional[str]) -> None:
        """
        Deterministic safety net for short replies to the last question.
        If the model returned nothing useful for "no" / "I don't know" / "I'd rather not say",
        interpret the reply ourselves so the conversation never loops.
        """
        if not asked_field:
            return
        target = _UNKNOWN_TARGET.get(asked_field)
        if target is None:
            return
        dumped = facts.model_dump(exclude_none=True)
        already_touched = bool(facts.unknown_fields or facts.declined_fields)

        if is_dont_know(text) and not already_touched and target not in facts.unknown_fields:
            facts.unknown_fields.append(target)
            return
        if is_decline(text) and not already_touched and target not in facts.declined_fields:
            facts.declined_fields.append(target)
            return

        yn = yes_no(text)
        if yn is None:
            return
        section, _, leaf = target.partition(".")
        if section == "flags" and getattr(facts.flags, leaf, "missing") is None:
            setattr(facts.flags, leaf, yn)
        elif section == "injury" and leaf in ("treatment_received", "medical_report_available") and not facts.injuries:
            facts.injuries.append(ExtractedInjury(**{leaf: yn}))
        elif section == "property" and leaf in ("recovered", "force_or_threat_used") and not facts.property:
            facts.property.append(ExtractedProperty(**{leaf: yn}))
        elif section == "weapon" and leaf == "used" and not facts.weapons:
            facts.weapons.append(ExtractedWeapon(used=yn))
        elif target == "incident.ongoing_or_repeated" and facts.incident.ongoing_or_repeated is None:
            facts.incident.ongoing_or_repeated = yn
        elif yn is False and section in ("witness", "evidence", "weapon", "property", "injury") and "flags" not in dumped:
            # "no" to a detail question about an item that does not exist yet: nothing to record
            return

    # --------------------------------------------------------------- progress
    @staticmethod
    def progress(state: CaseState) -> List[ProgressItem]:
        def fact_item(label: str, f: Fact, applicable: bool = True) -> ProgressItem:
            if not applicable:
                return ProgressItem(label=label, status="not_applicable")
            if f.is_answered:
                return ProgressItem(label=label, status="done", detail=f.display())
            if f.status in (FactStatus.UNKNOWN, FactStatus.DECLINED):
                return ProgressItem(label=label, status="unknown", detail=f.display())
            return ProgressItem(label=label, status="missing")

        inc, fl = state.incident, state.flags
        items = [
            ProgressItem(label="What happened", status="done" if (inc.description.is_answered or state.acts) else "missing",
                         detail=f"{len(state.acts)} act(s) recorded" if state.acts else None),
            fact_item("Date", inc.date), fact_item("Time", inc.time), fact_item("Location", inc.location),
            ProgressItem(label="Person(s) involved",
                         status="done" if state.accused else "missing",
                         detail=", ".join(a.label() for a in state.accused) or None),
            fact_item("Injuries", fl.injury_occurred, applicable=fl.injury_occurred.is_resolved or bool(state.injuries)
                      or any(a.type.value == "physical_assault" for a in state.acts)),
            fact_item("Weapon / object", fl.weapon_involved, applicable=fl.weapon_involved.is_resolved or bool(state.weapons)
                      or any(a.type.value in ("physical_assault", "threat") for a in state.acts)),
            fact_item("Property", fl.property_involved),
            fact_item("Witnesses", fl.witnesses_present),
            fact_item("Evidence", fl.evidence_available),
            fact_item("Your name", state.complainant.name),
        ]
        return items
