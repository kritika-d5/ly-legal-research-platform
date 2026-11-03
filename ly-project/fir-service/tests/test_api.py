"""API tests using FastAPI's TestClient (an in-process HTTP client; no server needed)."""
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.llm.factory import set_llm
from app.storage.repository import SQLiteRepository, set_repository
from tests.conftest import scripted_provider
from tests.test_manager_flow import OPENING, OPENING_FACTS


@pytest.fixture
def client(settings, monkeypatch):
    set_repository(SQLiteRepository(":memory:"))
    set_llm(scripted_provider({OPENING: OPENING_FACTS, "yes": {"user_intent": "confirm"}}))
    deps.reset_manager()
    monkeypatch.setattr("app.api.deps.get_settings", lambda: settings)
    from app.main import app
    with TestClient(app) as c:
        yield c
    set_llm(None)
    set_repository(None)
    deps.reset_manager()


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_create_case_and_send_message(client):
    created = client.post("/cases", json={"language": "en"})
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    assert "describe what happened" in created.json()["assistant_message"].lower()

    r = client.post(f"/cases/{case_id}/messages", json={"message": OPENING})
    assert r.status_code == 200
    body = r.json()
    assert body["next_action"] == "ask_question"
    assert body["case_state"]["accused"][0]["name"]["value"] == "Rahul"
    assert body["completeness"]["completion_percentage"] > 0
    assert any(p["label"] == "Date" and p["status"] == "done" for p in body["progress"])

    state = client.get(f"/cases/{case_id}/state").json()["case_state"]
    assert state["case_id"] == case_id and state["schema_version"] == "1.0"

    comp = client.get(f"/cases/{case_id}/completeness").json()
    assert comp["complete"] is False and comp["missing"]

    summ = client.get(f"/cases/{case_id}/summary").json()
    assert "Rahul" in summ["summary"]

    detail = client.get(f"/cases/{case_id}").json()
    assert len(detail["messages"]) == 3

    assert client.get("/cases").json()[0]["case_id"] == case_id


def test_empty_message_is_422(client):
    case_id = client.post("/cases").json()["case_id"]
    assert client.post(f"/cases/{case_id}/messages", json={"message": "   "}).status_code == 422


def test_unknown_case_is_404(client):
    assert client.get("/cases/does-not-exist/state").status_code == 404
    assert client.post("/cases/does-not-exist/messages", json={"message": "hi"}).status_code == 404


def test_confirm_flow(client):
    case_id = client.post("/cases").json()["case_id"]
    client.post(f"/cases/{case_id}/messages", json={"message": OPENING})
    r = client.post(f"/cases/{case_id}/confirm", json={"confirmed": True})
    assert r.status_code == 200
    assert r.json()["user_confirmed"] is True and r.json()["status"] == "complete"
    # further messages are refused politely
    again = client.post(f"/cases/{case_id}/messages", json={"message": "one more thing"}).json()
    assert again["next_action"] == "complete"
