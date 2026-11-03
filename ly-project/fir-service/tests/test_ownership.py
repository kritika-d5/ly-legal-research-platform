"""
Access control in proxied mode (PROXY_SHARED_SECRET set): the LY app sends a
shared secret plus the logged-in user's id, and each user sees only their own
cases. Standalone mode (no secret) is covered by test_api.py and must keep
working exactly as in Part 1.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.config import Settings
from app.llm.factory import set_llm
from app.storage.repository import SQLiteRepository, set_repository
from tests.conftest import scripted_provider
from tests.test_manager_flow import OPENING, OPENING_FACTS

SECRET = "test-shared-secret-0123456789abcdef"


def headers(user: str | None, secret: str | None = SECRET) -> dict:
    h = {}
    if secret is not None:
        h["X-Proxy-Secret"] = secret
    if user is not None:
        h["X-User-Id"] = user
    return h


ALICE, BOB = headers("user-alice"), headers("user-bob")


@pytest.fixture
def client(monkeypatch):
    proxied = Settings(llm_provider="mock", llm_question_wording=False, llm_contradiction_check=False,
                       database_url="sqlite:///:memory:", llm_api_key="", proxy_shared_secret=SECRET)
    set_repository(SQLiteRepository(":memory:"))
    set_llm(scripted_provider({OPENING: OPENING_FACTS}))
    deps.reset_manager()
    monkeypatch.setattr("app.api.deps.get_settings", lambda: proxied)
    from app.main import app
    with TestClient(app) as c:
        yield c
    set_llm(None)
    set_repository(None)
    deps.reset_manager()


def new_case(client, h) -> str:
    r = client.post("/cases", json={"language": "en"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["case_id"]


def test_missing_or_wrong_secret_is_refused(client):
    assert client.get("/cases", headers=headers("user-alice", secret=None)).status_code == 401
    assert client.get("/cases", headers=headers("user-alice", secret="wrong")).status_code == 401
    assert client.post("/cases", json={}, headers=headers("user-alice", secret="wrong")).status_code == 401


def test_secret_without_user_is_refused(client):
    assert client.get("/cases", headers=headers(None)).status_code == 401


def test_each_user_lists_only_their_own_cases(client):
    a1, a2 = new_case(client, ALICE), new_case(client, ALICE)
    b1 = new_case(client, BOB)
    alice_ids = {c["case_id"] for c in client.get("/cases", headers=ALICE).json()}
    bob_ids = {c["case_id"] for c in client.get("/cases", headers=BOB).json()}
    assert alice_ids == {a1, a2}
    assert bob_ids == {b1}


@pytest.mark.parametrize("path", ["", "/state", "/messages", "/completeness", "/summary"])
def test_other_users_case_is_not_found(client, path):
    case_id = new_case(client, ALICE)
    assert client.get(f"/cases/{case_id}{path}", headers=ALICE).status_code == 200
    # 404, not 403: Bob must not even learn that the case exists.
    assert client.get(f"/cases/{case_id}{path}", headers=BOB).status_code == 404


def test_other_user_cannot_post_or_confirm(client):
    case_id = new_case(client, ALICE)
    assert client.post(f"/cases/{case_id}/messages", json={"message": OPENING}, headers=BOB).status_code == 404
    assert client.post(f"/cases/{case_id}/confirm", json={"confirmed": True}, headers=BOB).status_code == 404
    # ...and Bob's attempt changed nothing for Alice.
    assert len(client.get(f"/cases/{case_id}/messages", headers=ALICE).json()) == 1
    r = client.post(f"/cases/{case_id}/messages", json={"message": OPENING}, headers=ALICE)
    assert r.status_code == 200


def test_unknown_case_is_not_found(client):
    assert client.get("/cases/does-not-exist", headers=ALICE).status_code == 404


def test_old_database_file_gains_owner_column(tmp_path):
    """A fir_chatbot.db made before owner_id existed must still open."""
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE cases (case_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL, status TEXT NOT NULL);
        INSERT INTO cases VALUES ('old-case', '2026-01-01', '2026-01-01', 'in_progress');
    """)
    conn.commit()
    conn.close()

    repo = SQLiteRepository(str(path))
    assert repo.get_owner("old-case") is None
    # Legacy cases have no owner, so no logged-in user sees them.
    assert repo.list_cases(owner_id="user-alice") == []
    assert [c["case_id"] for c in repo.list_cases()] == ["old-case"]
