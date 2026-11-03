"""Deterministic merge rules - no LLM involved."""
from app.extraction.merger import merge_facts
from app.extraction.schemas import ExtractedFacts
from app.models.case_state import CaseState, FactStatus, IdentityStatus
from tests.conftest import REF_DATE


def merge(state, payload, turn=1):
    return merge_facts(state, ExtractedFacts.model_validate(payload), turn, REF_DATE)


def test_basic_extraction_rahul_hit_me_yesterday():
    s = CaseState()
    merge(s, {"accused": [{"name": "Rahul", "identity_status": "known", "alleged_actions": ["hit the user"]}],
              "incident": {"date_description": "yesterday"},
              "acts": [{"type": "physical_assault", "description": "hit the user", "by": "Rahul"}]})
    assert s.accused[0].name.value == "Rahul" and s.accused[0].identity_status == IdentityStatus.KNOWN
    assert s.acts[0].type.value == "physical_assault"
    assert s.incident.date.value == "2026-09-08" and s.incident.date.status == FactStatus.EXPLICIT


def test_multiple_facts_in_one_message():
    s = CaseState()
    merge(s, {"incident": {"date_description": "yesterday", "time_hhmm": "20:00", "location": "near the station"},
              "accused": [{"name": "Rahul"}], "witnesses": [{"name": "Neha", "relationship": "friend"}]})
    assert s.incident.date.value and s.incident.time.value == "20:00" and s.incident.location.value
    assert s.accused[0].name.value == "Rahul" and s.witnesses[0].name.value == "Neha"
    assert s.flags.witnesses_present.value is True and s.flags.witnesses_present.status == FactStatus.EXTRACTED


def test_unknown_accused_is_preserved_not_invented():
    s = CaseState()
    merge(s, {"unknown_fields": ["accused.name"], "acts": [{"type": "physical_assault", "description": "hit the user", "by": "unknown"}]})
    assert len(s.accused) == 1
    assert s.accused[0].identity_status == IdentityStatus.UNKNOWN
    assert s.accused[0].name.value is None and s.accused[0].name.status == FactStatus.UNKNOWN
    assert "accused.name" in s.unknown_fields


def test_ambiguous_time_kept_approximate():
    s = CaseState()
    merge(s, {"incident": {"time_description": "night"}})
    assert s.incident.time.value is None and s.incident.time.approximate and s.incident.time.description == "night"
    assert s.incident.time.is_resolved  # we will not keep asking for the exact time


def test_repeated_information_does_not_duplicate():
    s = CaseState()
    payload = {"accused": [{"name": "Rahul"}], "acts": [{"type": "threat", "description": "threatened the user", "by": "Rahul"}],
               "witnesses": [{"name": "Neha"}], "property": [{"item": "phone"}]}
    r1 = merge(s, payload, 1)
    r2 = merge(s, payload, 2)
    assert len(s.accused) == 1 and len(s.acts) == 1 and len(s.witnesses) == 1 and len(s.property) == 1
    assert r1.changes and not r2.changes and not r2.conflicts


def test_correction_replaces_value_and_keeps_history():
    s = CaseState()
    merge(s, {"incident": {"date_description": "Wednesday"}}, 1)
    before = s.incident.date.value
    merge(s, {"incident": {"date_description": "Thursday"},
              "corrections": [{"field": "incident.date", "old_value": "Wednesday", "new_value": "Thursday"}]}, 2)
    assert s.incident.date.value != before
    assert s.incident.date.history[-1]["value"] == before and s.incident.date.history[-1]["reason"] == "corrected"
    assert s.incident.date.status == FactStatus.EXPLICIT and s.incident.date.turn == 2


def test_undeclared_change_becomes_conflict_and_keeps_old_value():
    s = CaseState()
    merge(s, {"incident": {"time_hhmm": "20:00"}}, 1)
    r = merge(s, {"incident": {"time_hhmm": "19:00"}}, 2)
    assert s.incident.time.value == "20:00"
    assert r.conflicts and r.conflicts[0].field == "incident.time"
    assert r.conflicts[0].earlier_value == "20:00" and r.conflicts[0].later_value == "19:00"


def test_vague_then_precise_is_refinement_not_conflict():
    s = CaseState()
    merge(s, {"incident": {"time_description": "evening"}}, 1)
    r = merge(s, {"incident": {"time_hhmm": "19:30", "time_description": "around 7:30"}}, 2)
    assert not r.conflicts and s.incident.time.value == "19:30" and s.incident.time.history[-1]["reason"] == "refined"


def test_narrative_elaboration_is_not_conflict():
    s = CaseState()
    merge(s, {"witnesses": [{"name": "Neha", "what_witnessed": "saw the incident"}]}, 1)
    r = merge(s, {"witnesses": [{"name": "Neha", "what_witnessed": "saw Rahul push the user"}]}, 2)
    assert not r.conflicts and "push" in s.witnesses[0].what_witnessed.value


def test_declined_field_marked_and_not_pressured():
    s = CaseState()
    merge(s, {"declined_fields": ["complainant.address"]})
    assert s.complainant.address.status == FactStatus.DECLINED and "complainant.address" in s.declined_fields
    assert s.complainant.address.is_resolved


def test_identity_contradiction_known_then_unknown():
    s = CaseState()
    merge(s, {"accused": [{"name": "Rahul", "identity_status": "known"}]}, 1)
    r = merge(s, {"unknown_fields": ["accused.name"]}, 2)
    assert any(c.kind == "identity" for c in r.conflicts)
    assert s.accused[0].name.value == "Rahul"  # not silently erased


def test_event_contradiction_no_injury_then_treatment():
    s = CaseState()
    merge(s, {"flags": {"injury_occurred": False}}, 1)
    r = merge(s, {"injuries": [{"type": "cut", "body_part": "hand", "treatment_received": True}]}, 2)
    assert any(c.kind == "event" and c.field == "flags.injury_occurred" for c in r.conflicts)


def test_inferred_and_uncertain_provenance():
    s = CaseState()
    merge(s, {"accused": [{"name": "Rahul"}], "incident": {"time_hhmm": "20:00"},
              "inferred_fields": ["accused.name"], "uncertain_fields": ["incident.time"]})
    assert s.accused[0].name.status == FactStatus.EXTRACTED
    assert s.incident.time.status == FactStatus.UNCERTAIN


def test_hallucination_resistance_empty_extraction_leaves_state_empty():
    s = CaseState()
    r = merge(s, {})
    assert not r.changes and not s.accused and not s.acts and s.incident.date.status == FactStatus.NOT_PROVIDED
    assert s.incident.location.value is None and s.flags.injury_occurred.value is None
