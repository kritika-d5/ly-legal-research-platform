"""
Live tests against the REAL configured LLM. They are skipped automatically
unless a provider with credentials is configured in .env (or LLM_PROVIDER=ollama).

Run just these with:
    pytest tests/test_live_llm.py -v -s
"""
import os

import pytest

from app.config import Settings
from app.conversation.manager import ConversationManager
from app.llm.factory import build_llm_from_settings
from app.models.case_state import FactStatus, IdentityStatus
from app.storage.repository import SQLiteRepository

settings = Settings()
_live = settings.llm_provider != "mock" and (settings.llm_api_key or settings.llm_provider == "ollama")
pytestmark = pytest.mark.skipif(not _live, reason="no live LLM configured (set LLM_API_KEY in .env)")


@pytest.fixture
def mgr():
    return ConversationManager(SQLiteRepository(":memory:"), build_llm_from_settings(), settings)


@pytest.mark.asyncio
async def test_basic_extraction(mgr):
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "Rahul hit me yesterday.")
    s = r.state
    assert s.accused and s.accused[0].name.value and "rahul" in s.accused[0].name.value.lower()
    assert any(a.type.value == "physical_assault" for a in s.acts)
    assert s.incident.date.value is not None  # 'yesterday' resolved deterministically


@pytest.mark.asyncio
async def test_unknown_accused(mgr):
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "Someone snatched my bag near the market last night. I don't know who he was.")
    s = r.state
    assert s.accused and s.accused[0].identity_status == IdentityStatus.UNKNOWN
    assert s.accused[0].name.value is None


@pytest.mark.asyncio
async def test_ambiguous_time_preserved(mgr):
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "It happened at night near my house, a man threatened me.")
    assert r.state.incident.time.value is None and r.state.incident.time.approximate


@pytest.mark.asyncio
async def test_hinglish_input(mgr):
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "Kal raat mere neighbour ne mujhe maara aur mera phone tod diya.")
    s = r.state
    assert s.incident.date.value is not None
    assert any(a.type.value in ("physical_assault", "property_damage") for a in s.acts)


@pytest.mark.asyncio
async def test_hallucination_resistance(mgr):
    state, _ = mgr.create_case()
    r = await mgr.handle_message(state.case_id, "Something bad happened to me.")
    s = r.state
    assert s.incident.date.value is None and s.incident.location.value is None
    assert not s.witnesses and not s.injuries and not s.property
    assert s.incident.time.status in (FactStatus.NOT_PROVIDED, FactStatus.UNKNOWN)
