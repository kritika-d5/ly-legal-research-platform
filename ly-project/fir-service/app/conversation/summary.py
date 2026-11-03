"""
Summary builder for the final user review step.

`build_summary(state)` is deterministic: every line comes straight from the
CaseState, so nothing can be invented. `polish_summary` optionally asks the LLM
to make it read more naturally, with strict "add nothing" instructions, and
falls back to the deterministic text on any failure.
"""
from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel

from app.conversation.prompts import SUMMARY_SYSTEM_PROMPT
from app.llm.base import LLMError, LLMProvider
from app.models.case_state import CaseState, Priority

log = logging.getLogger(__name__)

REVIEW_QUESTION = "Is this information correct? You can confirm, correct something, or add more details."


class SummaryOut(BaseModel):
    summary: str


def build_summary(state: CaseState) -> str:
    inc = state.incident
    lines: list[str] = ["Please review the information I have collected so far.", ""]

    lines.append("INCIDENT")
    if inc.description.is_answered:
        lines.append(f"- What happened (as you described it): {inc.description.value}")
    lines.append(f"- Date: {inc.date.display()}")
    lines.append(f"- Time: {inc.time.display()}")
    lines.append(f"- Location: {inc.location.display()}"
                 + (f" ({inc.location_details.value})" if inc.location_details.is_answered else ""))

    lines.append("")
    lines.append("PEOPLE INVOLVED")
    if state.complainant.name.is_answered:
        lines.append(f"- You (complainant): {state.complainant.name.value}")
    else:
        lines.append(f"- You (complainant): name {state.complainant.name.display()}")
    if state.complainant_is_victim.value is False:
        lines.append(f"- Person affected: {state.victim.name.display()}"
                     + (f", {state.victim.relationship_to_other_party.value}" if state.victim.relationship_to_other_party.is_answered else ""))
    if state.accused:
        for a in state.accused:
            extra = []
            if a.relationship_to_complainant.is_answered:
                extra.append(f"relationship: {a.relationship_to_complainant.value}")
            if a.description.is_answered:
                extra.append(f"description: {a.description.value}")
            if a.identity_status.value == "unknown":
                extra.append("identity not known to you")
            lines.append(f"- Person alleged to be involved: {a.label()}" + (f" ({'; '.join(extra)})" if extra else ""))
    else:
        lines.append("- Person alleged to be involved: not provided")

    lines.append("")
    lines.append("WHAT YOU STATED HAPPENED")
    if state.acts:
        for act in state.acts:
            lines.append(f"- {act.by or 'The person'} allegedly {act.description}")
    else:
        lines.append("- No specific acts recorded yet")

    if state.flags.injury_occurred.is_resolved or state.injuries:
        lines.append("")
        lines.append("INJURIES")
        if state.injuries:
            for i in state.injuries:
                parts = [f"{i.type.display()}"]
                if i.body_part.is_answered:
                    parts.append(f"on {i.body_part.value}")
                parts.append(f"treatment: {i.treatment_received.display()}")
                if i.hospital_or_doctor.is_answered:
                    parts.append(f"at {i.hospital_or_doctor.value}")
                parts.append(f"medical report: {i.medical_report_available.display()}")
                lines.append("- " + ", ".join(parts))
        else:
            lines.append(f"- Injury occurred: {state.flags.injury_occurred.display()}")

    if state.weapons or state.flags.weapon_involved.is_resolved:
        lines.append("")
        lines.append("OBJECTS / WEAPONS")
        if state.weapons:
            for w in state.weapons:
                lines.append(f"- {w.object.display()}" + (f", {w.how_used.value}" if w.how_used.is_answered else ""))
        else:
            lines.append(f"- Weapon or object involved: {state.flags.weapon_involved.display()}")

    if state.property or state.flags.property_involved.is_resolved:
        lines.append("")
        lines.append("PROPERTY")
        if state.property:
            for p in state.property:
                lines.append(f"- {p.item.display()}: {p.what_happened.display()}, approx. value {p.approximate_value.display()}, "
                             f"recovered: {p.recovered.display()}")
        else:
            lines.append(f"- Property involved: {state.flags.property_involved.display()}")

    lines.append("")
    lines.append("WITNESSES")
    if state.witnesses:
        for w in state.witnesses:
            lines.append(f"- {w.name.display()}" + (f" ({w.relationship.value})" if w.relationship.is_answered else "")
                         + (f": {w.what_witnessed.value}" if w.what_witnessed.is_answered else ""))
    else:
        lines.append(f"- {state.flags.witnesses_present.display() if state.flags.witnesses_present.is_resolved else 'none reported'}")

    lines.append("")
    lines.append("EVIDENCE")
    if state.evidence:
        for e in state.evidence:
            lines.append(f"- {e.type.value.replace('_', ' ')}: {e.description.display()}, with you: {e.in_possession.display()}")
    else:
        lines.append(f"- {state.flags.evidence_available.display() if state.flags.evidence_available.is_resolved else 'none reported'}")

    open_c = state.open_contradictions()
    if open_c:
        lines.append("")
        lines.append("POINTS NEEDING CLARIFICATION")
        for c in open_c:
            lines.append(f"- {c.explanation}")

    still_missing = [m for m in state.missing_information if m.priority != Priority.OPTIONAL]
    if still_missing:
        lines.append("")
        lines.append("STILL MISSING")
        for m in still_missing[:6]:
            lines.append(f"- {m.field.replace('_', ' ')}")

    lines.append("")
    lines.append(REVIEW_QUESTION)
    return "\n".join(lines)


async def polish_summary(llm: Optional[LLMProvider], draft: str, enabled: bool = True) -> str:
    if not enabled or llm is None:
        return draft
    try:
        out = await llm.generate_structured(SUMMARY_SYSTEM_PROMPT, f"=== DRAFT SUMMARY ===\n{draft}\n\nReturn the JSON now.", SummaryOut)
        text = out.summary.strip()
        if len(text) < 40:
            return draft
        if REVIEW_QUESTION not in text:
            text = text.rstrip() + "\n\n" + REVIEW_QUESTION
        return text
    except LLMError as exc:
        log.warning("summary polish failed (%s); using deterministic summary", type(exc).__name__)
        return draft
