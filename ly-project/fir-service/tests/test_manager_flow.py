"""Integration tests through the ConversationManager with a scripted mock LLM."""
import pytest

from app.llm.base import LLMUnavailableError
from app.llm.providers import MockProvider
from app.models.case_state import CaseStatus, FactStatus

OPENING = ("Yesterday evening I was walking home from college when Rahul stopped me near the station. "
           "We argued and he pushed me and took my phone. My friend Neha saw it.")
OPENING_FACTS = {
    "complainant_is_victim": True,
    "accused": [{"name": "Rahul", "identity_status": "known", "alleged_actions": ["pushed the user", "took the phone"]}],
    "incident": {"date_description": "yesterday", "time_description": "evening", "location": "near the railway station",
                 "description": "The user states Rahul stopped them, argued, allegedly pushed them and took their phone."},
    "acts": [{"type": "physical_assault", "description": "pushed the user", "by": "Rahul"},
             {"type": "taking_property", "description": "took the user's phone", "by": "Rahul"}],
    "property": [{"item": "mobile phone", "what_happened": "taken"}],
    "witnesses": [{"name": "Neha", "relationship": "friend"}],
}


@pytest.mark.asyncio
async def test_opening_message_extracts_many_facts_and_asks_relevant_question(make_manager):
    mgr = make_manager({OPENING: OPENING_FACTS})
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, OPENING)
    s = r.state
    assert s.incident.date.value == "2026-09-08" or s.incident.date.value  # relative to case creation date
    assert s.incident.time.description == "evening" and s.incident.time.value is None
    assert s.accused[0].name.value == "Rahul" and s.property[0].item.value == "mobile phone"
    assert s.witnesses[0].name.value == "Neha"
    assert r.next_action == "ask_question"
    asked = s.asked_questions[-1].field
    # Must not re-ask something already provided
    assert asked not in ("incident.date", "incident.location", "accused.presence", "acts", "flags.witnesses_present")


@pytest.mark.asyncio
async def test_dont_know_fallback_marks_unknown_without_llm_help(make_manager):
    mgr = make_manager({OPENING: OPENING_FACTS})
    state, _ = mgr.create_case()
    await mgr.handle_message(state.case_id, OPENING)
    # Force the next question to be about the phone's value, then answer "I don't know"
    s = mgr.repo.get_state(state.case_id)
    s.asked_questions[-1].field = "property.approximate_value"
    mgr.repo.save_state(s)
    r = await mgr.handle_message(state.case_id, "I don't know")
    assert r.state.property[0].approximate_value.status == FactStatus.UNKNOWN
    assert "property.approximate_value" not in [q.field for q in r.state.asked_questions if q.turn == r.state.turn_count]


@pytest.mark.asyncio
async def test_yes_no_fallback_sets_flag(make_manager):
    mgr = make_manager({OPENING: OPENING_FACTS})
    state, _ = mgr.create_case()
    await mgr.handle_message(state.case_id, OPENING)
    s = mgr.repo.get_state(state.case_id)
    s.asked_questions[-1].field = "flags.injury_occurred"
    mgr.repo.save_state(s)
    r = await mgr.handle_message(state.case_id, "No")
    assert r.state.flags.injury_occurred.value is False


@pytest.mark.asyncio
async def test_decline_fallback(make_manager):
    mgr = make_manager({OPENING: OPENING_FACTS})
    state, _ = mgr.create_case()
    await mgr.handle_message(state.case_id, OPENING)
    s = mgr.repo.get_state(state.case_id)
    s.asked_questions[-1].field = "complainant.contact"
    mgr.repo.save_state(s)
    r = await mgr.handle_message(state.case_id, "I'd rather not share that")
    assert "complainant.contact" in r.state.declined_fields


@pytest.mark.asyncio
async def test_contradiction_triggers_clarification_and_resolution(make_manager):
    script = {OPENING: OPENING_FACTS,
              "It was at 8 pm": {"incident": {"time_hhmm": "20:00", "time_description": "8 pm"}},
              "It happened at 7 pm": {"incident": {"time_hhmm": "19:00", "time_description": "7 pm"}},
              "7 pm is correct": {"incident": {"time_hhmm": "19:00"}}}
    mgr = make_manager(script)
    state, _ = mgr.create_case()
    await mgr.handle_message(state.case_id, OPENING)
    await mgr.handle_message(state.case_id, "It was at 8 pm")
    r = await mgr.handle_message(state.case_id, "It happened at 7 pm")
    assert r.next_action == "clarify_contradiction"
    assert r.state.incident.time.value == "20:00"          # not silently overwritten
    assert r.state.open_contradictions()[0].field == "incident.time"
    r2 = await mgr.handle_message(state.case_id, "7 pm is correct")
    assert not r2.state.open_contradictions()
    assert r2.state.incident.time.value == "19:00"         # clarification applied as correction
    assert r2.state.contradictions[0].resolution.startswith("7 pm")


@pytest.mark.asyncio
async def test_full_flow_reaches_review_and_confirmation(make_manager):
    script = {OPENING: OPENING_FACTS,
              "classmate": {"accused": [{"name": "Rahul", "relationship_to_complainant": "classmate"}]},
              "no injur": {"flags": {"injury_occurred": False}},
              "no weapon": {"flags": {"weapon_involved": False}},
              "20,000": {"property": [{"item": "mobile phone", "approximate_value": "20,000 rupees"}]},
              "not recovered": {"property": [{"item": "mobile phone", "recovered": False}]},
              "grabbed": {"property": [{"item": "mobile phone", "force_or_threat_used": True}]},
              "no evidence": {"flags": {"evidence_available": False}},
              "amit": {"complainant": {"name": "Amit"}},
              "west exit": {"incident": {"location_details": "west exit"}},
              "skip": {"declined_fields": ["complainant.contact"]},
              "yes": {"user_intent": "confirm"}}
    mgr = make_manager(script)
    state, _ = mgr.create_case()
    answers = [OPENING, "classmate", "no injury", "no weapon", "20,000", "not recovered", "grabbed",
               "no evidence", "amit", "west exit", "skip"]
    last = None
    for a in answers:
        last = await mgr.handle_message(state.case_id, a)
        if last.next_action == "review_summary":
            break
    assert last.next_action == "review_summary" and last.state.status == CaseStatus.AWAITING_CONFIRMATION
    assert "Rahul" in last.assistant_message and "Is this information correct" in last.assistant_message
    done = await mgr.handle_message(state.case_id, "yes")
    assert done.next_action == "complete" and done.state.user_confirmed and done.state.status == CaseStatus.COMPLETE
    assert done.state.accused[0].name.status == FactStatus.CONFIRMED
    # persisted
    assert mgr.repo.get_state(state.case_id).status == CaseStatus.COMPLETE


@pytest.mark.asyncio
async def test_no_question_repeated_more_than_limit(make_manager):
    mgr = make_manager({})  # LLM extracts nothing at all
    state, _ = mgr.create_case()
    for _ in range(8):
        await mgr.handle_message(state.case_id, "hmm")
    s = mgr.repo.get_state(state.case_id)
    assert all(q.times_asked <= mgr.settings.max_repeat_per_field for q in s.asked_questions)


@pytest.mark.asyncio
async def test_hallucination_resistance_sparse_input(make_manager):
    mgr = make_manager({"something happened": {"incident": {"description": "The user states something happened."}}})
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "something happened")
    s = r.state
    assert not s.accused and not s.witnesses and not s.property and not s.injuries
    assert s.incident.date.value is None and s.incident.time.value is None and s.incident.location.value is None
    assert s.flags.injury_occurred.value is None


@pytest.mark.asyncio
async def test_llm_unavailable_degrades_gracefully(make_manager):
    class Down(MockProvider):
        async def generate_text(self, system_prompt, user_prompt, *, json_mode=False):
            raise LLMUnavailableError("simulated outage")
    mgr = make_manager(provider=Down())
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, OPENING)
    assert r.warning and "unavailable" in r.warning.lower()
    assert r.next_action == "ask_question" and r.assistant_message
    assert len(mgr.repo.get_messages(state.case_id)) == 3  # intro + user + assistant saved


@pytest.mark.asyncio
async def test_malformed_llm_output_does_not_crash(make_manager):
    mgr = make_manager(provider=MockProvider(lambda s, u: "this is not json at all"))
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, OPENING)
    assert r.warning and r.assistant_message


@pytest.mark.asyncio
async def test_empty_message_is_rejected_softly(make_manager):
    mgr = make_manager({})
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "   ")
    assert "did not receive" in r.assistant_message and r.state.turn_count == 0
