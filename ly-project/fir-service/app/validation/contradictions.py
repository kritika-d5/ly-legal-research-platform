"""
ContradictionDetector.

Two layers:
1. DETERMINISTIC: the merger reports `Conflict`s whenever a new value disagrees
   with a recorded one and the user did not declare a correction. We turn those
   into `Contradiction` records (typed, with severity) and de-duplicate them.
2. LLM (optional, configurable): a focused prompt looks at the timeline and the
   latest message for logical/timeline inconsistencies that field comparison
   cannot see ("I left at 7:30" vs "it happened at 8").

Contradictions are never silently resolved: they become clarification
questions, and the user's answer is recorded as `resolution`.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from app.extraction.merger import Conflict
from app.llm.base import LLMError, LLMProvider
from app.models.case_state import CaseState, Contradiction, ContradictionType, Severity
from app.utils.case_text import case_context_summary
from app.utils.text import normalize, token_overlap

log = logging.getLogger(__name__)

_KIND_TO_TYPE = {
    "direct": ContradictionType.DIRECT,
    "location": ContradictionType.LOCATION,
    "identity": ContradictionType.IDENTITY,
    "event": ContradictionType.EVENT,
    "relationship": ContradictionType.RELATIONSHIP,
    "timeline": ContradictionType.TIMELINE,
}
_SEVERITY = {
    ContradictionType.IDENTITY: Severity.HIGH,
    ContradictionType.EVENT: Severity.HIGH,
    ContradictionType.DIRECT: Severity.MEDIUM,
    ContradictionType.LOCATION: Severity.MEDIUM,
    ContradictionType.TIMELINE: Severity.MEDIUM,
    ContradictionType.RELATIONSHIP: Severity.LOW,
    ContradictionType.OTHER: Severity.LOW,
}
_FIELD_LABEL = {
    "incident.date": "the date of the incident",
    "incident.time": "the time of the incident",
    "incident.location": "where the incident happened",
    "accused.identity": "who the person was",
    "accused.name": "the person's name",
    "accused.relationship_to_complainant": "your relationship with the person",
    "flags.injury_occurred": "whether anyone was injured",
    "flags.weapon_involved": "whether any weapon or object was involved",
    "flags.witnesses_present": "whether anyone else was present",
    "flags.property_involved": "whether any property was involved",
    "property.recovered": "whether the property was recovered",
    "injury.treatment_received": "whether medical treatment was received",
}


class LLMContradictionItem(BaseModel):
    type: str = "other"
    field: str = "timeline"
    earlier_value: Optional[str] = None
    later_value: Optional[str] = None
    explanation: str = ""
    severity: str = "medium"


class LLMContradictionReport(BaseModel):
    contradictions: List[LLMContradictionItem] = Field(default_factory=list)


CONTRADICTION_SYSTEM_PROMPT = """You are a consistency checker for an incident-intake assistant.
You receive the facts recorded so far, the timeline of events, and the user's latest message.
Report ONLY clear, obvious inconsistencies in the user's own statements, such as:
- two different times/dates/places for the same event,
- an event order that is impossible (e.g. leaving a place before an incident that supposedly happened there later),
- "no injury" but later describes treatment,
- "stranger" but later "my neighbour",
- a named person but later "I don't know who it was".
Do NOT report: missing information, vague vs precise statements that are compatible ("evening" and "7:30 PM" are compatible), refinements, or anything requiring legal judgement.
If there is nothing clearly inconsistent, return {"contradictions": []}.
Return ONLY JSON: {"contradictions": [{"type": "direct|location|identity|event|timeline|relationship|other", "field": "dotted.field", "earlier_value": "...", "later_value": "...", "explanation": "one neutral sentence", "severity": "low|medium|high"}]}"""


def field_label(field: str) -> str:
    return _FIELD_LABEL.get(field, field.replace("_", " ").replace(".", " "))


class ContradictionDetector:
    def __init__(self, llm: Optional[LLMProvider] = None, use_llm: bool = False):
        self.llm = llm
        self.use_llm = use_llm and llm is not None

    # ---------------------------------------------------------- deterministic
    def from_conflicts(self, state: CaseState, conflicts: List[Conflict]) -> List[Contradiction]:
        added: List[Contradiction] = []
        for c in conflicts:
            ctype = _KIND_TO_TYPE.get(c.kind, ContradictionType.OTHER)
            if c.field in ("incident.date", "incident.time") and ctype == ContradictionType.DIRECT:
                ctype = ContradictionType.DIRECT
            if self._duplicate(state, c.field, c.earlier_value, c.later_value):
                continue
            contradiction = Contradiction(
                type=ctype, field=c.field, earlier_value=c.earlier_value, later_value=c.later_value,
                earlier_turn=c.earlier_turn, later_turn=c.later_turn,
                explanation=(f"Earlier {field_label(c.field)} was recorded as '{c.earlier_value}', "
                             f"but the latest message suggests '{c.later_value}'."),
                severity=_SEVERITY[ctype], requires_clarification=True,
            )
            state.contradictions.append(contradiction)
            added.append(contradiction)
            log.info("contradiction detected case=%s field=%s type=%s", state.case_id, c.field, ctype.value)
        return added

    @staticmethod
    def _duplicate(state: CaseState, field: str, earlier: Optional[str], later: Optional[str]) -> bool:
        for existing in state.contradictions:
            if existing.field != field:
                continue
            if existing.resolved:
                # same pair already clarified once -> do not re-raise identical pair
                if normalize(existing.earlier_value) == normalize(earlier) and normalize(existing.later_value) == normalize(later):
                    return True
                continue
            return True  # an open contradiction on this field already exists
        return False

    # ----------------------------------------------------------------- LLM
    async def llm_check(self, state: CaseState, latest_message: str, history: list[dict]) -> List[Contradiction]:
        """Optional extra pass. Never raises: on any LLM failure it returns []."""
        if not self.use_llm or len(state.timeline) + len(state.acts) < 2 or state.turn_count < 2:
            return []
        timeline = "\n".join(f"{t.sequence}. [{t.time_description or '-'}] {t.description}" for t in state.timeline) or "(none)"
        recent = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-6:])
        prompt = (f"=== RECORDED FACTS ===\n{case_context_summary(state)}\n\n=== TIMELINE ===\n{timeline}\n\n"
                  f"=== RECENT CONVERSATION ===\n{recent}\n\n=== LATEST USER MESSAGE ===\n{latest_message}\n\n"
                  "Return the JSON now.")
        try:
            report = await self.llm.generate_structured(CONTRADICTION_SYSTEM_PROMPT, prompt, LLMContradictionReport)
        except LLMError as exc:
            log.warning("llm contradiction check skipped: %s", type(exc).__name__)
            return []
        added: List[Contradiction] = []
        for item in report.contradictions[:3]:
            if not item.explanation:
                continue
            if any(token_overlap(x.explanation, item.explanation) >= 0.5 for x in state.contradictions):
                continue
            if any(not x.resolved and x.field == item.field for x in state.contradictions):
                continue
            try:
                ctype = ContradictionType(item.type)
            except ValueError:
                ctype = ContradictionType.OTHER
            try:
                sev = Severity(item.severity)
            except ValueError:
                sev = _SEVERITY[ctype]
            contradiction = Contradiction(
                type=ctype, field=item.field or "timeline", earlier_value=item.earlier_value,
                later_value=item.later_value, later_turn=state.turn_count, explanation=item.explanation,
                severity=sev, requires_clarification=True)
            state.contradictions.append(contradiction)
            added.append(contradiction)
        return added

    # ------------------------------------------------------------ resolution
    @staticmethod
    def resolve(state: CaseState, contradiction_id: str, resolution_text: str) -> None:
        for c in state.contradictions:
            if c.contradiction_id == contradiction_id:
                c.resolved = True
                c.requires_clarification = False
                c.resolution = resolution_text[:500]
                return


def clarification_question(c: Contradiction) -> str:
    """Neutral wording that presents both statements and asks which is right."""
    label = field_label(c.field)
    if c.earlier_value and c.later_value:
        return (f"I want to make sure I record this correctly. Earlier, {label} was noted as "
                f"'{c.earlier_value}', but your last message suggests '{c.later_value}'. "
                f"Which one is correct?")
    return f"I noticed something that may be inconsistent: {c.explanation} Could you clarify what actually happened?"
