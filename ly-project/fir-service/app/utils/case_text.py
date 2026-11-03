"""
Compact, LLM-friendly text views of a CaseState.

`case_context_summary` is injected into prompts so the model knows what is
already recorded (avoids duplicate people, helps resolve "he"/"there").
It is short on purpose: prompts cost tokens.
"""
from __future__ import annotations

from app.models.case_state import CaseState, Fact


def _f(fact: Fact) -> str:
    return fact.display()


def case_context_summary(state: CaseState) -> str:
    lines: list[str] = []
    inc = state.incident
    if inc.description.is_answered:
        lines.append(f"Incident summary: {inc.description.value}")
    if inc.date.is_resolved:
        lines.append(f"Date: {_f(inc.date)}")
    if inc.time.is_resolved:
        lines.append(f"Time: {_f(inc.time)}")
    if inc.location.is_resolved:
        lines.append(f"Location: {_f(inc.location)}")
    if inc.location_details.is_answered:
        lines.append(f"Location details: {_f(inc.location_details)}")

    if state.complainant.name.is_answered:
        lines.append(f"Complainant name: {state.complainant.name.value}")
    if state.complainant_is_victim.is_answered:
        lines.append(f"Complainant is the victim: {state.complainant_is_victim.value}")
    if state.victim.name.is_answered:
        lines.append(f"Victim name: {state.victim.name.value}")

    for a in state.accused:
        bits = [f"identity={a.identity_status.value}"]
        if a.relationship_to_complainant.is_answered:
            bits.append(f"relationship={a.relationship_to_complainant.value}")
        if a.description.is_answered:
            bits.append(f"description={a.description.value}")
        if a.alleged_actions:
            bits.append("actions=" + "; ".join(a.alleged_actions[:4]))
        lines.append(f"Accused '{a.label()}': " + ", ".join(bits))

    if state.acts:
        lines.append("Acts: " + "; ".join(f"{x.type.value} - {x.description} (by {x.by or 'unknown'})" for x in state.acts))
    if state.injuries:
        lines.append("Injuries: " + "; ".join(
            f"{_f(i.type)} on {_f(i.body_part)}, treatment={_f(i.treatment_received)}" for i in state.injuries))
    if state.weapons:
        lines.append("Objects/weapons: " + "; ".join(_f(w.object) for w in state.weapons))
    if state.property:
        lines.append("Property: " + "; ".join(
            f"{_f(p.item)} ({_f(p.what_happened)}), value={_f(p.approximate_value)}, recovered={_f(p.recovered)}"
            for p in state.property))
    if state.witnesses:
        lines.append("Witnesses: " + "; ".join(f"{_f(w.name)} ({_f(w.relationship)})" for w in state.witnesses))
    if state.evidence:
        lines.append("Evidence: " + "; ".join(f"{e.type.value}: {_f(e.description)}" for e in state.evidence))

    flags = state.flags
    flag_bits = []
    for name in ("injury_occurred", "weapon_involved", "property_involved", "threat_involved",
                 "witnesses_present", "evidence_available"):
        fact: Fact = getattr(flags, name)
        if fact.is_resolved:
            flag_bits.append(f"{name}={_f(fact)}")
    if flag_bits:
        lines.append("Flags: " + ", ".join(flag_bits))

    if state.unknown_fields:
        lines.append("User does NOT know: " + ", ".join(sorted(set(state.unknown_fields))))
    if state.declined_fields:
        lines.append("User declined to share: " + ", ".join(sorted(set(state.declined_fields))))
    return "\n".join(lines)
