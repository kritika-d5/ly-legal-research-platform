from app.extraction.merger import Conflict
from app.models.case_state import CaseState, ContradictionType, Severity
from app.validation.contradictions import ContradictionDetector, clarification_question


def test_conflict_becomes_typed_contradiction():
    s = CaseState()
    det = ContradictionDetector()
    added = det.from_conflicts(s, [Conflict("incident.time", "20:00", "19:00", 1, 3, "direct")])
    assert len(added) == 1
    c = added[0]
    assert c.type == ContradictionType.DIRECT and c.severity == Severity.MEDIUM
    assert c.requires_clarification and not c.resolved and c.earlier_turn == 1 and c.later_turn == 3


def test_identity_conflict_is_high_severity():
    s = CaseState()
    c = ContradictionDetector().from_conflicts(s, [Conflict("accused.identity", "Rahul", "unknown", 1, 2, "identity")])[0]
    assert c.type == ContradictionType.IDENTITY and c.severity == Severity.HIGH


def test_duplicate_open_contradiction_not_added_twice():
    s = CaseState()
    det = ContradictionDetector()
    det.from_conflicts(s, [Conflict("incident.location", "station", "home", 1, 2, "location")])
    det.from_conflicts(s, [Conflict("incident.location", "station", "market", 1, 3, "location")])
    assert len(s.contradictions) == 1


def test_resolution_and_open_list():
    s = CaseState()
    det = ContradictionDetector()
    c = det.from_conflicts(s, [Conflict("incident.time", "20:00", "19:00", 1, 3)])[0]
    assert s.open_contradictions()
    det.resolve(s, c.contradiction_id, "It was 7 PM")
    assert not s.open_contradictions() and c.resolution == "It was 7 PM"


def test_clarification_question_is_neutral_and_mentions_both_values():
    s = CaseState()
    c = ContradictionDetector().from_conflicts(s, [Conflict("incident.time", "20:00", "19:00", 1, 3)])[0]
    q = clarification_question(c)
    assert "20:00" in q and "19:00" in q and "?" in q
    assert "lying" not in q.lower() and "wrong" not in q.lower()
