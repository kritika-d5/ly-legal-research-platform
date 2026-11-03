"""
Persistence layer.

WHAT IS A DATABASE FOR HERE?
----------------------------
If we kept cases in a Python dictionary, they would vanish whenever the server
restarts. SQLite is a real database that lives in ONE file (data/fir_chatbot.db)
and needs no installation - Python ships with the `sqlite3` module.

SCHEMA (three tables)
---------------------
cases        one row per case: id, timestamps, status
messages     every user/assistant message, in order (the transcript)
case_states  the full CaseState as a JSON document, one row per case

Storing the CaseState as JSON keeps the schema flexible while Part 1 evolves.
Queries that need structure use the `cases` table.

SWAPPING TO POSTGRESQL LATER
----------------------------
Everything above the `Repository` interface is unaware of SQLite. To move to
PostgreSQL: implement a `PostgresRepository(Repository)` with the same six
methods (using `psycopg` or SQLAlchemy) and return it from `get_repository()`.
"""
from __future__ import annotations

import abc
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import List, Optional

from app.config import get_settings
from app.models.case_state import CaseState


class CaseNotFoundError(Exception):
    pass


class Repository(abc.ABC):
    @abc.abstractmethod
    def create_case(self, state: CaseState) -> None: ...

    @abc.abstractmethod
    def get_state(self, case_id: str) -> CaseState: ...

    @abc.abstractmethod
    def save_state(self, state: CaseState) -> None: ...

    @abc.abstractmethod
    def add_message(self, case_id: str, role: str, content: str, turn: int) -> None: ...

    @abc.abstractmethod
    def get_messages(self, case_id: str) -> List[dict]: ...

    @abc.abstractmethod
    def list_cases(self, limit: int = 50) -> List[dict]: ...


_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_id     TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    status      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     TEXT NOT NULL REFERENCES cases(case_id),
    role        TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
    content     TEXT NOT NULL,
    turn        INTEGER NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_case ON messages(case_id, id);
CREATE TABLE IF NOT EXISTS case_states (
    case_id     TEXT PRIMARY KEY REFERENCES cases(case_id),
    state_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
"""


class SQLiteRepository(Repository):
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        # One connection shared across FastAPI worker threads, guarded by a lock.
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def create_case(self, state: CaseState) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO cases(case_id, created_at, updated_at, status) VALUES (?,?,?,?)",
                (state.case_id, state.created_at, state.updated_at, state.status.value))
            self._conn.execute(
                "INSERT INTO case_states(case_id, state_json, updated_at) VALUES (?,?,?)",
                (state.case_id, state.to_json(indent=0), state.updated_at))
            self._conn.commit()

    def get_state(self, case_id: str) -> CaseState:
        with self._lock:
            row = self._conn.execute("SELECT state_json FROM case_states WHERE case_id=?", (case_id,)).fetchone()
        if row is None:
            raise CaseNotFoundError(case_id)
        return CaseState.from_json(row["state_json"])

    def save_state(self, state: CaseState) -> None:
        state.touch()
        with self._lock:
            cur = self._conn.execute(
                "UPDATE case_states SET state_json=?, updated_at=? WHERE case_id=?",
                (state.to_json(indent=0), state.updated_at, state.case_id))
            if cur.rowcount == 0:
                raise CaseNotFoundError(state.case_id)
            self._conn.execute("UPDATE cases SET updated_at=?, status=? WHERE case_id=?",
                               (state.updated_at, state.status.value, state.case_id))
            self._conn.commit()

    def add_message(self, case_id: str, role: str, content: str, turn: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO messages(case_id, role, content, turn, created_at) VALUES (?,?,?,?,?)",
                (case_id, role, content, turn, self._now()))
            self._conn.commit()

    def get_messages(self, case_id: str) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT role, content, turn, created_at FROM messages WHERE case_id=? ORDER BY id", (case_id,)).fetchall()
        return [dict(r) for r in rows]

    def list_cases(self, limit: int = 50) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT case_id, created_at, updated_at, status FROM cases ORDER BY updated_at DESC LIMIT ?",
                (limit,)).fetchall()
        return [dict(r) for r in rows]


_repo: Optional[Repository] = None


def get_repository() -> Repository:
    global _repo
    if _repo is None:
        _repo = SQLiteRepository(get_settings().sqlite_path)
    return _repo


def set_repository(repo: Optional[Repository]) -> None:
    """Used by tests to inject an in-memory repository."""
    global _repo
    _repo = repo
