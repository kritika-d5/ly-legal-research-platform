"""
CompletenessChecker - deterministic, context-aware "what is still missing?"

No LLM here. A table of RULES says, for each field:
  * when it APPLIES (e.g. injury details only matter if an injury was mentioned)
  * when it is RESOLVED (answered, or user said unknown / declined, or we
    already asked the maximum number of times)
  * its PRIORITY and a template question

The checker returns a CompletenessReport used by the question engine, the API
and the frontend progress panel.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional

from pydantic import BaseModel, Field

from app.models.case_state import ActType, CaseState, IdentityStatus, MissingInformation, Priority

PRIORITY_ORDER = {Priority.HIGH: 0, Priority.MEDIUM: 1, Priority.LOW: 2, Priority.OPTIONAL: 3}
PRIORITY_WEIGHT = {Priority.HIGH: 4, Priority.MEDIUM: 2, Priority.LOW: 1, Priority.OPTIONAL: 0}


class CompletenessReport(BaseModel):
    complete: bool
    completion_percentage: int
    missing: List[MissingInformation] = Field(default_factory=list)
    recommended_questions: List[str] = Field(default_factory=list)
    applicable_fields: int = 0
    resolved_fields: int = 0
    exhausted_fields: List[str] = Field(default_factory=list)  # asked max times, user could not answer


@dataclass
class Rule:
    field: str
    priority: Priority
    question: str
    applies: Callable[[CaseState], bool]
    resolved: Callable[[CaseState], bool]
    reason: str = ""
    resolve_when_asked: bool = False   # for "soft" fields we cannot detect structurally


# ----------------------------------------------------------------- helpers
def _has_act(state: CaseState, *types: ActType) -> bool:
    return any(a.type in types for a in state.acts)


def _flag_true(state: CaseState, name: str) -> bool:
    return getattr(state.flags, name).value is True


def _physical(state: CaseState) -> bool:
    return _has_act(state, ActType.PHYSICAL_ASSAULT) or bool(state.weapons) or _flag_true(state, "weapon_involved")


def _known_accused(state: CaseState):
    return [a for a in state.accused if a.identity_status == IdentityStatus.KNOWN]


def _first_label(state: CaseState) -> str:
    return state.accused[0].label() if state.accused else "the person"


def _first_item(state: CaseState) -> str:
    for p in state.property:
        if p.item.value:
            return str(p.item.value)
    return "the property"


def _threat_acts(state: CaseState):
    return [a for a in state.acts if a.type == ActType.THREAT]


def _taken_property(state: CaseState):
    return [p for p in state.property if (p.what_happened.value or "").lower().startswith(("taken", "stolen", "snatch", "took"))
            or not p.what_happened.value]


# ----------------------------------------------------------------- the rules
RULES: List[Rule] = [
    # ---------------- Priority 1: core incident facts ----------------
    Rule("incident.description", Priority.HIGH,
         "Could you describe what happened, in your own words?",
         applies=lambda s: True,
         resolved=lambda s: s.incident.description.is_answered or bool(s.acts),
         reason="core fact: what happened"),
    Rule("incident.date", Priority.HIGH,
         "Approximately when did this happen? The day or date is enough.",
         applies=lambda s: True,
         resolved=lambda s: s.incident.date.is_resolved,
         reason="core fact: when"),
    Rule("incident.location", Priority.HIGH,
         "Where did this happen?",
         applies=lambda s: True,
         resolved=lambda s: s.incident.location.is_resolved,
         reason="core fact: where"),
    Rule("accused.presence", Priority.HIGH,
         "Who was involved? If you know the person, please share their name; if not, that's okay - just say so.",
         applies=lambda s: True,
         resolved=lambda s: bool(s.accused),
         reason="core fact: who"),
    Rule("acts", Priority.HIGH,
         "What exactly did the person do?",
         applies=lambda s: bool(s.accused),
         resolved=lambda s: bool(s.acts),
         reason="core fact: what the person did"),

    # ---------------- Priority 2: immediate factual details ----------------
    Rule("accused.identity", Priority.MEDIUM,
         "Do you know who this person was? If not, could you describe them?",
         applies=lambda s: any(a.identity_status == IdentityStatus.NOT_PROVIDED for a in s.accused),
         resolved=lambda s: all(a.identity_status != IdentityStatus.NOT_PROVIDED for a in s.accused),
         reason="a person was mentioned but it is unclear whether they are known"),
    Rule("accused.description", Priority.MEDIUM,
         "Could you describe the person - approximate age, build, clothing, or anything else you noticed?",
         applies=lambda s: any(a.identity_status in (IdentityStatus.UNKNOWN, IdentityStatus.PARTIALLY_KNOWN) for a in s.accused),
         resolved=lambda s: all(a.description.is_resolved for a in s.accused
                                if a.identity_status in (IdentityStatus.UNKNOWN, IdentityStatus.PARTIALLY_KNOWN)),
         reason="the person is not fully identified"),
    Rule("accused.relationship_to_complainant", Priority.MEDIUM,
         "How do you know {accused}? What is your relationship with them?",
         applies=lambda s: bool(_known_accused(s)),
         resolved=lambda s: all(a.relationship_to_complainant.is_resolved for a in _known_accused(s)),
         reason="the person is known to you"),
    Rule("flags.injury_occurred", Priority.MEDIUM,
         "Were you, or anyone else, physically hurt during this incident?",
         applies=_physical,
         resolved=lambda s: s.flags.injury_occurred.is_resolved,
         reason="physical contact was described"),
    Rule("injury.details", Priority.MEDIUM,
         "What kind of injury was it, and which part of the body was affected?",
         applies=lambda s: _flag_true(s, "injury_occurred"),
         resolved=lambda s: any(i.type.is_resolved or i.body_part.is_resolved for i in s.injuries),
         reason="an injury was mentioned"),
    Rule("injury.treatment_received", Priority.MEDIUM,
         "Did you receive any medical treatment for the injury?",
         applies=lambda s: _flag_true(s, "injury_occurred"),
         resolved=lambda s: any(i.treatment_received.is_resolved for i in s.injuries),
         reason="an injury was mentioned"),
    Rule("flags.weapon_involved", Priority.MEDIUM,
         "Was any object or weapon used or shown during the incident?",
         applies=lambda s: _has_act(s, ActType.PHYSICAL_ASSAULT, ActType.THREAT),
         resolved=lambda s: s.flags.weapon_involved.is_resolved,
         reason="an assault or threat was described"),
    Rule("weapon.object", Priority.MEDIUM,
         "What object or weapon was it, and how was it used?",
         applies=lambda s: _flag_true(s, "weapon_involved"),
         resolved=lambda s: any(w.object.is_resolved for w in s.weapons),
         reason="a weapon/object was mentioned"),
    Rule("property.item", Priority.MEDIUM,
         "What property was involved?",
         applies=lambda s: _flag_true(s, "property_involved"),
         resolved=lambda s: any(p.item.is_resolved for p in s.property),
         reason="property was involved"),
    Rule("property.approximate_value", Priority.MEDIUM,
         "Approximately what is the value of {item}?",
         applies=lambda s: any(p.item.is_answered for p in s.property),
         resolved=lambda s: all(p.approximate_value.is_resolved for p in s.property if p.item.is_answered),
         reason="property was involved"),
    Rule("property.recovered", Priority.MEDIUM,
         "Has {item} been recovered or returned since then?",
         applies=lambda s: any(p.item.is_answered for p in _taken_property(s)),
         resolved=lambda s: all(p.recovered.is_resolved for p in _taken_property(s) if p.item.is_answered),
         reason="property was taken"),
    Rule("property.force_or_threat_used", Priority.MEDIUM,
         "When {item} was taken, was any force used or any threat made?",
         applies=lambda s: any(p.item.is_answered for p in _taken_property(s)) and _has_act(s, ActType.TAKING_PROPERTY),
         resolved=lambda s: all(p.force_or_threat_used.is_resolved for p in _taken_property(s) if p.item.is_answered)
                            or s.flags.threat_involved.is_resolved and _has_act(s, ActType.PHYSICAL_ASSAULT),
         reason="property was taken"),
    Rule("threat.nature", Priority.MEDIUM,
         "What exactly was said or done as a threat?",
         applies=lambda s: bool(_threat_acts(s)) or _flag_true(s, "threat_involved"),
         resolved=lambda s: any(len(a.description) > 45 for a in _threat_acts(s)),
         reason="a threat was mentioned", resolve_when_asked=True),
    Rule("threat.method", Priority.MEDIUM,
         "How was the threat made - in person, by phone call, message, or some other way?",
         applies=lambda s: bool(_threat_acts(s)) or _flag_true(s, "threat_involved"),
         resolved=lambda s: False,
         reason="a threat was mentioned", resolve_when_asked=True),
    Rule("victim.name", Priority.MEDIUM,
         "Who was the person this happened to, and what is your relationship with them?",
         applies=lambda s: s.complainant_is_victim.value is False,
         resolved=lambda s: s.victim.name.is_resolved,
         reason="you are reporting on behalf of someone else"),

    # ---------------- Priority 3: supporting information ----------------
    Rule("incident.time", Priority.LOW,
         "Approximately what time of day did this happen?",
         applies=lambda s: True,
         resolved=lambda s: s.incident.time.is_resolved,
         reason="helps place the incident"),
    Rule("flags.witnesses_present", Priority.LOW,
         "Was anyone else present who saw or heard what happened?",
         applies=lambda s: True,
         resolved=lambda s: s.flags.witnesses_present.is_resolved,
         reason="supporting information"),
    Rule("witness.name", Priority.LOW,
         "Could you share the name of the person who witnessed it, if you know it?",
         applies=lambda s: _flag_true(s, "witnesses_present"),
         resolved=lambda s: bool(s.witnesses) and all(w.name.is_resolved for w in s.witnesses),
         reason="a witness was mentioned"),
    Rule("witness.what_witnessed", Priority.LOW,
         "What did {witness} see or hear?",
         applies=lambda s: any(w.name.is_answered for w in s.witnesses),
         resolved=lambda s: all(w.what_witnessed.is_resolved for w in s.witnesses if w.name.is_answered),
         reason="a witness was named", resolve_when_asked=True),
    Rule("flags.evidence_available", Priority.LOW,
         "Do you have any evidence, such as photos, videos, CCTV footage, messages, or medical documents?",
         applies=lambda s: True,
         resolved=lambda s: s.flags.evidence_available.is_resolved,
         reason="supporting information"),
    Rule("evidence.description", Priority.LOW,
         "What evidence do you have, and is it currently with you?",
         applies=lambda s: _flag_true(s, "evidence_available"),
         resolved=lambda s: bool(s.evidence) and all(e.description.is_resolved for e in s.evidence),
         reason="evidence was mentioned"),
    Rule("injury.hospital_or_doctor", Priority.LOW,
         "Where were you treated - which hospital or doctor?",
         applies=lambda s: any(i.treatment_received.value is True for i in s.injuries),
         resolved=lambda s: all(i.hospital_or_doctor.is_resolved for i in s.injuries if i.treatment_received.value is True),
         reason="medical treatment was mentioned"),
    Rule("injury.medical_report_available", Priority.LOW,
         "Do you have any medical report or prescription from that treatment?",
         applies=lambda s: any(i.treatment_received.value is True for i in s.injuries),
         resolved=lambda s: all(i.medical_report_available.is_resolved for i in s.injuries if i.treatment_received.value is True),
         reason="medical treatment was mentioned"),
    Rule("incident.location_details", Priority.LOW,
         "Could you describe the exact spot more precisely - a landmark, building, or area name?",
         applies=lambda s: s.incident.location.is_answered,
         resolved=lambda s: s.incident.location_details.is_resolved,
         reason="helps locate the incident precisely", resolve_when_asked=True),
    Rule("incident.ongoing_or_repeated", Priority.LOW,
         "Has this happened before, or was it a one-time incident?",
         applies=lambda s: _has_act(s, ActType.HARASSMENT, ActType.THREAT, ActType.STALKING_OR_FOLLOWING,
                                    ActType.ONLINE_OR_MESSAGE_BASED),
         resolved=lambda s: s.incident.ongoing_or_repeated.is_resolved,
         reason="harassment/threat pattern may be repeated", resolve_when_asked=True),
    Rule("flags.property_involved", Priority.LOW,
         "Was any of your property taken or damaged during this?",
         applies=lambda s: bool(s.acts) and not _has_act(s, ActType.TAKING_PROPERTY, ActType.PROPERTY_DAMAGE),
         resolved=lambda s: s.flags.property_involved.is_resolved,
         reason="supporting information"),
    Rule("complainant_is_victim", Priority.LOW,
         "Did this happen to you personally, or are you reporting on behalf of someone else?",
         applies=lambda s: bool(s.acts),
         resolved=lambda s: s.complainant_is_victim.is_resolved,
         reason="needed to structure the complaint"),
    Rule("complainant.name", Priority.LOW,
         "May I have your name for the record?",
         applies=lambda s: True,
         resolved=lambda s: s.complainant.name.is_resolved,
         reason="needed for the record"),

    # ---------------- Priority 4: optional ----------------
    Rule("accused.address_or_whereabouts", Priority.OPTIONAL,
         "Do you know where {accused} lives or can usually be found?",
         applies=lambda s: bool(_known_accused(s)),
         resolved=lambda s: all(a.address_or_whereabouts.is_resolved for a in _known_accused(s)),
         reason="the person is known to you"),
    Rule("flags.police_informed_earlier", Priority.OPTIONAL,
         "Have you already informed the police or anyone in authority about this?",
         applies=lambda s: True,
         resolved=lambda s: s.flags.police_informed_earlier.is_resolved,
         reason="context"),
    Rule("complainant.contact", Priority.LOW,
         "Could you share a contact number or address? You may skip this if you prefer.",
         applies=lambda s: True,
         resolved=lambda s: s.complainant.contact.is_resolved or s.complainant.address.is_resolved,
         reason="needed to contact you; optional"),
]


# ----------------------------------------------------------------- checker
def _times_asked(state: CaseState, field: str) -> int:
    return sum(q.times_asked for q in state.asked_questions if q.field == field)


def fill_template(question: str, state: CaseState) -> str:
    witness = next((str(w.name.value) for w in state.witnesses if w.name.value), "the witness")
    item = _first_item(state)
    if not item.lower().startswith(("the ", "my ", "your ", "a ", "an ")):
        item = "the " + item
    return (question.replace("{accused}", _first_label(state))
                    .replace("{item}", item)
                    .replace("{witness}", witness))


def check_completeness(state: CaseState, max_repeat_per_field: int = 2) -> CompletenessReport:
    missing: List[MissingInformation] = []
    exhausted: List[str] = []
    applicable = resolved_count = 0
    weight_total = weight_done = 0

    for rule in RULES:
        if not rule.applies(state):
            continue
        applicable += 1
        w = PRIORITY_WEIGHT[rule.priority]
        weight_total += w
        asked = _times_asked(state, rule.field)
        is_resolved = rule.resolved(state) or (rule.resolve_when_asked and asked >= 1)
        is_exhausted = asked >= max_repeat_per_field
        if is_resolved or is_exhausted:
            resolved_count += 1
            weight_done += w
            if is_exhausted and not is_resolved:
                exhausted.append(rule.field)
            continue
        missing.append(MissingInformation(
            field=rule.field, priority=rule.priority, reason=rule.reason,
            suggested_question=fill_template(rule.question, state)))

    missing.sort(key=lambda m: PRIORITY_ORDER[m.priority])
    pct = int(round(100 * weight_done / weight_total)) if weight_total else 0
    blocking = [m for m in missing if m.priority != Priority.OPTIONAL]
    return CompletenessReport(
        complete=not blocking,
        completion_percentage=pct,
        missing=missing,
        recommended_questions=[m.suggested_question for m in missing[:3]],
        applicable_fields=applicable,
        resolved_fields=resolved_count,
        exhausted_fields=exhausted,
    )


def next_missing(report: CompletenessReport) -> Optional[MissingInformation]:
    return report.missing[0] if report.missing else None
