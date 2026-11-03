"""
FactMerger - deterministic, rule-based merge of ExtractedFacts into CaseState.

WHY NOT LET THE LLM REWRITE THE CASE STATE?
-------------------------------------------
Because it would silently drop or alter earlier facts. Instead the model only
reports what the *latest* message contains, and this code decides how that
combines with what we already know:

    * empty existing fact          -> set it
    * same value again             -> no change (no duplicates)
    * vague earlier, precise now   -> refine ("evening" -> "19:30")
    * different value, declared correction -> replace, keep history
    * different value, NOT a correction    -> KEEP old value, report a Conflict
      (the contradiction detector turns conflicts into clarification questions)

Everything here is plain Python; no network calls; fully unit-testable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, List, Optional, Sequence

from app.extraction.schemas import (
    ExtractedAccused, ExtractedEvidence, ExtractedFacts, ExtractedInjury,
    ExtractedPerson, ExtractedProperty, ExtractedWeapon, ExtractedWitness,
)
from app.models.case_state import (
    Accused, Act, ActType, CaseState, Evidence, EvidenceType, Fact, FactStatus,
    IdentityStatus, Injury, Person, PropertyItem, TimelineEvent, Weapon, Witness,
)
from app.utils.dates import resolve_date, resolve_time
from app.utils.text import normalize, token_overlap


@dataclass
class Conflict:
    """A value that disagrees with what was recorded earlier (not declared as a correction)."""

    field: str
    earlier_value: Optional[str]
    later_value: Optional[str]
    earlier_turn: Optional[int]
    later_turn: int
    kind: str = "direct"   # direct | location | identity | event | relationship


@dataclass
class MergeResult:
    state: CaseState
    changes: List[str] = field(default_factory=list)       # human-readable log of what changed
    conflicts: List[Conflict] = field(default_factory=list)
    ambiguities: List[str] = field(default_factory=list)   # unresolved pronoun references etc.


# Free-text descriptive fields: a longer/different wording later is an elaboration, not a contradiction.
_NARRATIVE_FIELDS = {
    "accused.description", "accused.alias", "witness.what_witnessed", "injury.severity_as_described",
    "weapon.how_used", "weapon.description", "property.description", "evidence.description", "evidence.reference",
    "incident.location_details", "complainant.other_details", "victim.other_details", "injury.hospital_or_doctor",
    "accused.address_or_whereabouts", "injury.type", "injury.body_part",
}

_ACT_TYPES = {t.value for t in ActType}
_EVIDENCE_TYPES = {t.value for t in EvidenceType}


def _act_type(value: str | None) -> ActType:
    v = normalize(value).replace(" ", "_")
    return ActType(v) if v in _ACT_TYPES else ActType.OTHER


def _evidence_type(value: str | None) -> EvidenceType:
    v = normalize(value).replace(" ", "_")
    aliases = {"photo": "photograph", "photos": "photograph", "pictures": "photograph", "image": "photograph",
               "whatsapp": "messages", "sms": "messages", "chat": "messages", "chats": "messages",
               "recording": "audio", "voice_note": "audio", "bill": "bill_or_receipt", "receipt": "bill_or_receipt",
               "medical": "medical_report", "mlc": "medical_report", "camera": "cctv", "cctv_footage": "cctv"}
    v = aliases.get(v, v)
    return EvidenceType(v) if v in _EVIDENCE_TYPES else EvidenceType.OTHER


class FactMerger:
    def __init__(self, state: CaseState, facts: ExtractedFacts, turn: int, reference_date: date,
                 correction_fields: Optional[set[str]] = None):
        self.state = state
        self.facts = facts
        self.turn = turn
        self.reference_date = reference_date
        self.result = MergeResult(state=state)
        # Fields the user is currently clarifying (after a contradiction question) also count as corrections.
        self.corrected_fields = {c.field for c in facts.corrections} | set(correction_fields or ())
        # A message whose whole purpose is to correct something: treat all differences as corrections.
        self.correction_mode = facts.user_intent == "correct"
        self.inferred = set(facts.inferred_fields)
        self.uncertain = set(facts.uncertain_fields)

    # ------------------------------------------------------------------ public
    def merge(self) -> MergeResult:
        f = self.facts
        self._merge_person(self.state.complainant, f.complainant, "complainant")
        self._set(self.state.complainant_is_victim, f.complainant_is_victim, "complainant_is_victim")
        self._merge_person(self.state.victim, f.victim, "victim")
        self._merge_incident()
        self._merge_accused(f.accused)
        self._merge_acts()
        self._merge_injuries(f.injuries)
        self._merge_weapons(f.weapons)
        self._merge_property(f.property)
        self._merge_witnesses(f.witnesses)
        self._merge_evidence(f.evidence)
        self._merge_timeline()
        self._merge_flags()
        self._derive_flags_from_lists()
        self._apply_unknowns(f.unknown_fields)
        self._apply_declines(f.declined_fields)
        for d in f.denials:
            self.state.notes.append(f"turn {self.turn}: user denied - {d}")
        self.result.ambiguities.extend(f.ambiguous_references)
        if f.detected_language and self.state.turn_count <= 1:
            self.state.language = f.detected_language
        self.state.touch()
        return self.result

    # ------------------------------------------------------------ core setter
    def _status_for(self, path: str) -> FactStatus:
        if path in self.uncertain:
            return FactStatus.UNCERTAIN
        if path in self.inferred:
            return FactStatus.EXTRACTED
        return FactStatus.EXPLICIT

    def _set(
        self,
        fact: Fact,
        new_value: Any,
        path: str,
        *,
        approximate: bool = False,
        description: Optional[str] = None,
        kind: str = "direct",
    ) -> bool:
        """Apply the merge rules to one Fact. Returns True if the fact changed."""
        if new_value is None and not (approximate and description):
            return False
        if isinstance(new_value, str) and not new_value.strip():
            return False

        status = self._status_for(path)
        incoming_display = new_value if new_value is not None else description

        # 1) nothing recorded yet (or user previously didn't know / declined but now answers)
        if not fact.is_answered:
            self._assign(fact, new_value, status, approximate, description)
            self.result.changes.append(f"{path} = {incoming_display}")
            return True

        # 2) same value again -> keep, maybe strengthen provenance
        if new_value is not None and fact.value is not None and normalize(new_value) == normalize(fact.value):
            if fact.status == FactStatus.EXTRACTED and status == FactStatus.EXPLICIT:
                fact.status = FactStatus.EXPLICIT
            return False
        if new_value is None and fact.value is None and normalize(description) == normalize(fact.description):
            return False

        # 3) vague before, precise now -> refine (not a contradiction)
        if fact.value is None and new_value is not None:
            fact.history.append({"value": None, "description": fact.description, "turn": fact.turn, "reason": "refined"})
            self._assign(fact, new_value, status, approximate, description or fact.description)
            self.result.changes.append(f"{path} refined to {incoming_display}")
            return True

        # 4) precise before, vague now -> ignore the vaguer restatement
        if fact.value is not None and new_value is None:
            return False

        # 5) narrative fields: combine wordings instead of raising a conflict
        if path in _NARRATIVE_FIELDS and isinstance(new_value, str) and isinstance(fact.value, str):
            old_n, new_n = normalize(fact.value), normalize(new_value)
            if old_n in new_n:
                combined = new_value
            elif new_n in old_n:
                return False
            elif token_overlap(fact.value, new_value) >= 0.5 or path in self.corrected_fields or self.correction_mode:
                combined = new_value
            else:
                combined = f"{fact.value}; {new_value}"
            fact.history.append({"value": fact.value, "turn": fact.turn, "reason": "elaborated"})
            self._assign(fact, combined, status, approximate, description)
            self.result.changes.append(f"{path} elaborated")
            return True

        # 6) genuinely different values
        if path in self.corrected_fields or self.correction_mode:
            fact.history.append({"value": fact.value, "description": fact.description, "turn": fact.turn, "reason": "corrected"})
            self._assign(fact, new_value, FactStatus.EXPLICIT, approximate, description)
            self.result.changes.append(f"{path} corrected: {fact.history[-1]['value']} -> {new_value}")
            return True

        self.result.conflicts.append(Conflict(
            field=path, earlier_value=str(fact.value), later_value=str(new_value),
            earlier_turn=fact.turn, later_turn=self.turn, kind=kind,
        ))
        return False

    def _assign(self, fact: Fact, value: Any, status: FactStatus, approximate: bool, description: Optional[str]) -> None:
        fact.value = value
        fact.status = status
        fact.approximate = approximate
        fact.description = description
        fact.turn = self.turn

    # ------------------------------------------------------------- sections
    def _merge_person(self, person: Person, incoming: ExtractedPerson, prefix: str) -> None:
        self._set(person.name, incoming.name, f"{prefix}.name")
        self._set(person.age, incoming.age, f"{prefix}.age")
        self._set(person.gender, incoming.gender, f"{prefix}.gender")
        self._set(person.address, incoming.address, f"{prefix}.address")
        self._set(person.contact, incoming.contact, f"{prefix}.contact")
        self._set(person.relationship_to_other_party, incoming.relationship_to_other_party,
                  f"{prefix}.relationship_to_other_party", kind="relationship")
        self._set(person.other_details, incoming.other_details, f"{prefix}.other_details")

    def _merge_incident(self) -> None:
        inc, new = self.state.incident, self.facts.incident
        rd = resolve_date(new.date_iso, new.date_description, self.reference_date)
        if rd.iso or rd.description:
            self._set(inc.date, rd.iso, "incident.date", approximate=rd.approximate, description=rd.description)
        rt = resolve_time(new.time_hhmm, new.time_description)
        if rt.hhmm or rt.description:
            self._set(inc.time, rt.hhmm, "incident.time", approximate=rt.approximate, description=rt.description)
        self._set(inc.location, new.location, "incident.location", kind="location")
        self._set(inc.location_details, new.location_details, "incident.location_details", kind="location")
        self._set(inc.ongoing_or_repeated, new.ongoing_or_repeated, "incident.ongoing_or_repeated")
        # The description grows: append new narrative rather than conflict on wording differences.
        if new.description and new.description.strip():
            if not inc.description.is_answered:
                self._assign(inc.description, new.description.strip(), FactStatus.EXTRACTED, False, None)
                self.result.changes.append("incident.description set")
            elif token_overlap(inc.description.value or "", new.description) < 0.6:
                inc.description.value = f"{inc.description.value} {new.description.strip()}"
                self.result.changes.append("incident.description extended")

    def _find_accused_for(self, item: ExtractedAccused) -> Optional[Accused]:
        if item.name:
            hit = self.state.find_accused(item.name)
            if hit:
                return hit
        if item.alias:
            hit = self.state.find_accused(item.alias)
            if hit:
                return hit
        # Named incoming person, exactly one existing unnamed accused -> the user is now naming them
        if item.name:
            unnamed = [a for a in self.state.accused if not a.name.is_answered]
            if len(unnamed) == 1 and len(self.state.accused) == 1:
                return unnamed[0]
        # Unnamed incoming person: attach to the single existing accused if there is exactly one
        if not item.name and len(self.state.accused) == 1:
            return self.state.accused[0]
        # Unnamed incoming, several existing: attach to an unnamed one if exactly one exists
        if not item.name:
            unnamed = [a for a in self.state.accused if not a.name.value]
            if len(unnamed) == 1:
                return unnamed[0]
        return None

    def _merge_accused(self, items: Sequence[ExtractedAccused]) -> None:
        for item in items:
            target = self._find_accused_for(item)
            if target is None:
                target = Accused()
                self.state.accused.append(target)
                self.result.changes.append(f"accused added: {item.name or item.description or 'unidentified'}")
            self._set(target.name, item.name, "accused.name", kind="identity")
            self._set(target.alias, item.alias, "accused.alias")
            self._set(target.description, item.description, "accused.description")
            self._set(target.relationship_to_complainant, item.relationship_to_complainant,
                      "accused.relationship_to_complainant", kind="relationship")
            self._set(target.address_or_whereabouts, item.address_or_whereabouts, "accused.address_or_whereabouts")
            for action in item.alleged_actions:
                if action and all(token_overlap(action, a) < 0.8 for a in target.alleged_actions):
                    target.alleged_actions.append(action)
            self._update_identity(target, item.identity_status)

    def _update_identity(self, acc: Accused, incoming: Optional[str]) -> None:
        if acc.name.value:
            new_status = IdentityStatus.KNOWN
        elif incoming == "unknown":
            new_status = IdentityStatus.UNKNOWN
        elif incoming == "partially_known" or acc.description.value or acc.alias.value:
            new_status = IdentityStatus.PARTIALLY_KNOWN
        elif incoming == "known":
            new_status = IdentityStatus.KNOWN
        else:
            new_status = acc.identity_status
        # Known-with-name earlier, "unknown" now -> identity contradiction
        if acc.identity_status == IdentityStatus.KNOWN and acc.name.value and incoming == "unknown":
            self.result.conflicts.append(Conflict(
                field="accused.identity", earlier_value=acc.name.value, later_value="unknown",
                earlier_turn=acc.name.turn, later_turn=self.turn, kind="identity"))
            return
        if new_status != acc.identity_status:
            acc.identity_status = new_status
            self.result.changes.append(f"accused '{acc.label()}' identity_status = {new_status.value}")

    def _merge_acts(self) -> None:
        for item in self.facts.acts:
            if not item.description or not item.description.strip():
                continue
            atype = _act_type(item.type)
            duplicate = False
            for existing in self.state.acts:
                same_person = normalize(existing.by) == normalize(item.by) or not item.by or not existing.by
                if existing.type == atype and same_person and token_overlap(existing.description, item.description) >= 0.5:
                    duplicate = True
                    break
            if duplicate:
                continue
            by = item.by
            hit = self.state.find_accused(by) if by else None
            if hit:
                by = hit.label()
            self.state.acts.append(Act(type=atype, description=item.description.strip(), by=by,
                                       against=item.against, status=self._status_for("acts"), turn=self.turn))
            self.result.changes.append(f"act added: {atype.value} - {item.description.strip()}")

    def _merge_injuries(self, items: Sequence[ExtractedInjury]) -> None:
        for item in items:
            target: Optional[Injury] = None
            for existing in self.state.injuries:
                if (item.body_part and normalize(existing.body_part.value) == normalize(item.body_part)) or \
                   (item.type and normalize(existing.type.value) == normalize(item.type)):
                    target = existing
                    break
            if target is None and len(self.state.injuries) == 1 and not (item.body_part or item.type):
                target = self.state.injuries[0]   # e.g. "I went to the hospital" refines the only injury
            if target is None and len(self.state.injuries) == 1 and not self.state.injuries[0].type.value \
                    and not self.state.injuries[0].body_part.value:
                target = self.state.injuries[0]
            if target is None:
                target = Injury()
                self.state.injuries.append(target)
                self.result.changes.append("injury added")
            self._set(target.type, item.type, "injury.type")
            self._set(target.body_part, item.body_part, "injury.body_part")
            self._set(target.severity_as_described, item.severity_as_described, "injury.severity_as_described")
            self._set(target.treatment_received, item.treatment_received, "injury.treatment_received", kind="event")
            self._set(target.hospital_or_doctor, item.hospital_or_doctor, "injury.hospital_or_doctor")
            self._set(target.medical_report_available, item.medical_report_available, "injury.medical_report_available")
            self._set(target.injured_person, item.injured_person, "injury.injured_person")

    def _merge_weapons(self, items: Sequence[ExtractedWeapon]) -> None:
        for item in items:
            target = next((w for w in self.state.weapons if item.object and
                           normalize(w.object.value) == normalize(item.object)), None)
            if target is None and len(self.state.weapons) == 1 and not item.object:
                target = self.state.weapons[0]
            if target is None:
                target = Weapon()
                self.state.weapons.append(target)
                self.result.changes.append(f"weapon/object added: {item.object}")
            self._set(target.object, item.object, "weapon.object")
            self._set(target.description, item.description, "weapon.description")
            self._set(target.used, item.used, "weapon.used")
            self._set(target.how_used, item.how_used, "weapon.how_used")

    def _merge_property(self, items: Sequence[ExtractedProperty]) -> None:
        for item in items:
            target = None
            for p in self.state.property:
                a, b = normalize(p.item.value), normalize(item.item)
                if a and b and (a in b or b in a or token_overlap(a, b) >= 0.5):
                    target = p
                    break
            if target is None and len(self.state.property) == 1 and not item.item:
                target = self.state.property[0]
            if target is None:
                target = PropertyItem()
                self.state.property.append(target)
                self.result.changes.append(f"property added: {item.item}")
            self._set(target.item, item.item, "property.item")
            self._set(target.description, item.description, "property.description")
            self._set(target.approximate_value, item.approximate_value, "property.approximate_value")
            self._set(target.owner, item.owner, "property.owner")
            self._set(target.what_happened, item.what_happened, "property.what_happened", kind="event")
            self._set(target.recovered, item.recovered, "property.recovered", kind="event")
            self._set(target.force_or_threat_used, item.force_or_threat_used, "property.force_or_threat_used", kind="event")

    def _merge_witnesses(self, items: Sequence[ExtractedWitness]) -> None:
        for item in items:
            target = None
            if item.name:
                target = next((w for w in self.state.witnesses if normalize(w.name.value) == normalize(item.name)), None)
                if target is None:
                    unnamed = [w for w in self.state.witnesses if not w.name.is_answered]
                    if len(unnamed) == 1 and (not item.relationship or not unnamed[0].relationship.value or
                                              normalize(item.relationship) == normalize(unnamed[0].relationship.value)):
                        target = unnamed[0]
            elif len(self.state.witnesses) == 1:
                target = self.state.witnesses[0]
            if target is None:
                target = Witness()
                self.state.witnesses.append(target)
                self.result.changes.append(f"witness added: {item.name or item.relationship or 'unnamed'}")
            self._set(target.name, item.name, "witness.name")
            self._set(target.relationship, item.relationship, "witness.relationship", kind="relationship")
            self._set(target.contact, item.contact, "witness.contact")
            self._set(target.what_witnessed, item.what_witnessed, "witness.what_witnessed")

    def _merge_evidence(self, items: Sequence[ExtractedEvidence]) -> None:
        for item in items:
            etype = _evidence_type(item.type)
            target = None
            for e in self.state.evidence:
                if e.type == etype and (not item.description or not e.description.value or
                                        token_overlap(e.description.value, item.description) >= 0.4):
                    target = e
                    break
            if target is None:
                target = Evidence(type=etype)
                self.state.evidence.append(target)
                self.result.changes.append(f"evidence added: {etype.value}")
            self._set(target.description, item.description, "evidence.description")
            self._set(target.in_possession, item.in_possession, "evidence.in_possession")
            self._set(target.reference, item.reference, "evidence.reference")

    def _merge_timeline(self) -> None:
        for ev in self.facts.timeline:
            if not ev.description or not ev.description.strip():
                continue
            if any(token_overlap(t.description, ev.description) >= 0.7 for t in self.state.timeline):
                continue
            self.state.timeline.append(TimelineEvent(
                sequence=len(self.state.timeline) + 1, time_description=ev.time_description,
                description=ev.description.strip(), turn=self.turn))
            self.result.changes.append(f"timeline event added: {ev.description.strip()[:60]}")

    def _merge_flags(self) -> None:
        fl, new = self.state.flags, self.facts.flags
        self._set(fl.injury_occurred, new.injury_occurred, "flags.injury_occurred", kind="event")
        self._set(fl.weapon_involved, new.weapon_involved, "flags.weapon_involved", kind="event")
        self._set(fl.property_involved, new.property_involved, "flags.property_involved", kind="event")
        self._set(fl.threat_involved, new.threat_involved, "flags.threat_involved", kind="event")
        self._set(fl.witnesses_present, new.witnesses_present, "flags.witnesses_present", kind="event")
        self._set(fl.evidence_available, new.evidence_available, "flags.evidence_available", kind="event")
        self._set(fl.police_informed_earlier, new.police_informed_earlier, "flags.police_informed_earlier")

    def _derive_flags_from_lists(self) -> None:
        """If the user described an injury, we know an injury occurred, etc. Marked as system-extracted."""
        fl, st = self.state.flags, self.state
        pairs = [
            (fl.injury_occurred, bool(st.injuries), "flags.injury_occurred"),
            (fl.weapon_involved, bool(st.weapons), "flags.weapon_involved"),
            (fl.property_involved, bool(st.property), "flags.property_involved"),
            (fl.witnesses_present, bool(st.witnesses), "flags.witnesses_present"),
            (fl.evidence_available, bool(st.evidence), "flags.evidence_available"),
            (fl.threat_involved, any(a.type == ActType.THREAT for a in st.acts), "flags.threat_involved"),
        ]
        for fact, present, path in pairs:
            if present and not fact.is_answered:
                fact.history.append({"value": fact.value, "turn": fact.turn, "reason": "derived"})
                self._assign(fact, True, FactStatus.EXTRACTED, False, None)
                self.result.changes.append(f"{path} derived = True")
            elif present and fact.value is False:
                # "I was not injured" but later described an injury -> event contradiction
                self.result.conflicts.append(Conflict(
                    field=path, earlier_value="False", later_value="True (details described)",
                    earlier_turn=fact.turn, later_turn=self.turn, kind="event"))

    # ------------------------------------------------- unknown / declined paths
    def _facts_for_path(self, path: str, create: bool) -> List[Fact]:
        """Map a dotted path such as 'incident.time' or 'witness.name' to Fact objects."""
        st = self.state
        parts = path.split(".")
        head = parts[0]
        leaf = parts[1] if len(parts) > 1 else None

        if head == "complainant_is_victim":
            return [st.complainant_is_victim]
        simple = {"complainant": st.complainant, "victim": st.victim, "incident": st.incident, "flags": st.flags}
        if head in simple and leaf and hasattr(simple[head], leaf):
            return [getattr(simple[head], leaf)]

        list_map = {
            "accused": (st.accused, Accused), "injury": (st.injuries, Injury), "injuries": (st.injuries, Injury),
            "weapon": (st.weapons, Weapon), "weapons": (st.weapons, Weapon),
            "property": (st.property, PropertyItem), "witness": (st.witnesses, Witness),
            "witnesses": (st.witnesses, Witness), "evidence": (st.evidence, Evidence),
        }
        if head in list_map:
            items, cls = list_map[head]
            if leaf in (None, "identity"):
                return []
            if not items and create:
                items.append(cls())
            out = []
            for it in items:
                if hasattr(it, leaf):
                    fact = getattr(it, leaf)
                    if isinstance(fact, Fact) and not fact.is_answered:
                        out.append(fact)
            return out
        return []

    def _apply_unknowns(self, paths: Sequence[str]) -> None:
        for path in paths:
            path = path.strip()
            if not path:
                continue
            if path in ("accused.identity", "accused.name", "accused"):
                targets = [a for a in self.state.accused if not a.name.value]
                if not targets and not self.state.accused:
                    self.state.accused.append(Accused())
                    targets = [self.state.accused[0]]
                    self.result.changes.append("accused added: unidentified")
                for acc in targets:
                    if acc.identity_status == IdentityStatus.KNOWN and acc.name.value:
                        continue
                    acc.identity_status = IdentityStatus.UNKNOWN
                    if not acc.name.is_answered:
                        acc.name.status = FactStatus.UNKNOWN
                        acc.name.turn = self.turn
                # Known accused exists, user now says they don't know who it was
                known = [a for a in self.state.accused if a.identity_status == IdentityStatus.KNOWN and a.name.value]
                if known and not targets:
                    self.result.conflicts.append(Conflict(
                        field="accused.identity", earlier_value=known[0].name.value, later_value="unknown",
                        earlier_turn=known[0].name.turn, later_turn=self.turn, kind="identity"))
                    continue
            else:
                for fact in self._facts_for_path(path, create=True):
                    fact.status = FactStatus.UNKNOWN
                    fact.turn = self.turn
            if path not in self.state.unknown_fields:
                self.state.unknown_fields.append(path)
            self.result.changes.append(f"{path} marked unknown")

    def _apply_declines(self, paths: Sequence[str]) -> None:
        for path in paths:
            path = path.strip()
            if not path:
                continue
            for fact in self._facts_for_path(path, create=False):
                fact.status = FactStatus.DECLINED
                fact.turn = self.turn
            if path not in self.state.declined_fields:
                self.state.declined_fields.append(path)
            self.result.changes.append(f"{path} marked declined")


def merge_facts(state: CaseState, facts: ExtractedFacts, turn: int, reference_date: date,
                correction_fields: Optional[set[str]] = None) -> MergeResult:
    """Public entry point. Mutates `state` in place and returns a MergeResult."""
    return FactMerger(state, facts, turn, reference_date, correction_fields).merge()
