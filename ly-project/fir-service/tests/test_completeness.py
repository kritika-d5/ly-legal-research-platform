from app.extraction.merger import merge_facts
from app.extraction.schemas import ExtractedFacts
from app.models.case_state import AskedQuestion, CaseState, Priority
from app.validation.completeness import check_completeness
from tests.conftest import REF_DATE


def seeded(payload):
    s = CaseState()
    merge_facts(s, ExtractedFacts.model_validate(payload), 1, REF_DATE)
    return s


def fields(report):
    return [m.field for m in report.missing]


def test_empty_case_asks_core_facts_first():
    r = check_completeness(CaseState())
    assert r.complete is False and r.completion_percentage == 0
    assert r.missing[0].priority == Priority.HIGH
    assert "incident.description" in fields(r)[:5] and "incident.date" in fields(r)[:5]


def test_property_incident_produces_property_questions():
    s = seeded({"accused": [{"name": "Rahul"}], "incident": {"date_description": "yesterday", "location": "station"},
                "acts": [{"type": "taking_property", "description": "took the phone", "by": "Rahul"}],
                "property": [{"item": "phone", "what_happened": "taken"}]})
    f = fields(check_completeness(s))
    assert "property.approximate_value" in f and "property.recovered" in f and "property.force_or_threat_used" in f
    assert "injury.details" not in f and "flags.injury_occurred" not in f  # no assault described


def test_injury_incident_produces_injury_questions():
    s = seeded({"accused": [{"name": "Rahul"}], "incident": {"date_description": "yesterday", "location": "home"},
                "acts": [{"type": "physical_assault", "description": "hit the user with a stick", "by": "Rahul"}],
                "weapons": [{"object": "stick"}]})
    f = fields(check_completeness(s))
    assert "flags.injury_occurred" in f
    s.flags.injury_occurred.value = True
    s.flags.injury_occurred.status = "explicit"
    f2 = fields(check_completeness(s))
    assert "injury.details" in f2 and "injury.treatment_received" in f2
    assert "property.approximate_value" not in f2


def test_threat_incident_produces_threat_questions():
    s = seeded({"accused": [{"name": "Rahul"}], "incident": {"date_description": "today", "location": "office"},
                "acts": [{"type": "threat", "description": "threatened the user", "by": "Rahul"}]})
    f = fields(check_completeness(s))
    assert "threat.nature" in f and "threat.method" in f and "flags.weapon_involved" in f


def test_unknown_and_declined_fields_are_not_asked():
    s = seeded({"unknown_fields": ["incident.time"], "declined_fields": ["complainant.name"],
                "accused": [{"name": "Rahul"}], "acts": [{"type": "threat", "description": "threatened", "by": "Rahul"}],
                "incident": {"date_description": "yesterday", "location": "home"}})
    f = fields(check_completeness(s))
    assert "incident.time" not in f and "complainant.name" not in f


def test_exhausted_field_counts_as_handled():
    s = CaseState()
    s.asked_questions.append(AskedQuestion(field="incident.location", question="Where?", turn=1, times_asked=2))
    r = check_completeness(s, max_repeat_per_field=2)
    assert "incident.location" not in fields(r) and "incident.location" in r.exhausted_fields


def test_optional_fields_do_not_block_completion():
    s = seeded({"complainant": {"name": "Amit"}, "complainant_is_victim": True,
                "accused": [{"name": "Rahul", "relationship_to_complainant": "neighbour"}],
                "incident": {"date_description": "yesterday", "time_description": "evening", "location": "home",
                             "location_details": "front gate", "description": "argument and abuse"},
                "acts": [{"type": "verbal_abuse", "description": "abused the user", "by": "Rahul"}],
                "flags": {"witnesses_present": False, "evidence_available": False, "property_involved": False},
                "declined_fields": ["complainant.contact"]})
    r = check_completeness(s)
    assert r.complete is True
    assert all(m.priority == Priority.OPTIONAL for m in r.missing)
