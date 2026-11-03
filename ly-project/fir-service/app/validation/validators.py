"""
Structural validators for CaseState - cheap sanity checks run before saving and
before handing the case to Part 2. They catch bugs, not user errors.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from app.models.case_state import SCHEMA_VERSION, CaseState, CaseStatus


def validate_case_state(state: CaseState) -> List[str]:
    """Return a list of problems (empty list = valid)."""
    problems: List[str] = []
    if state.schema_version != SCHEMA_VERSION:
        problems.append(f"schema_version {state.schema_version} != {SCHEMA_VERSION}")
    if not state.case_id:
        problems.append("case_id missing")

    d = state.incident.date
    if d.value is not None:
        try:
            datetime.strptime(str(d.value), "%Y-%m-%d")
        except ValueError:
            problems.append(f"incident.date.value '{d.value}' is not YYYY-MM-DD")
    t = state.incident.time
    if t.value is not None:
        try:
            datetime.strptime(str(t.value), "%H:%M")
        except ValueError:
            problems.append(f"incident.time.value '{t.value}' is not HH:MM")

    seqs = [e.sequence for e in state.timeline]
    if seqs != sorted(seqs):
        problems.append("timeline sequence numbers are not ascending")

    ids = [a.accused_id for a in state.accused]
    if len(ids) != len(set(ids)):
        problems.append("duplicate accused_id")

    if state.status == CaseStatus.COMPLETE and not state.user_confirmed:
        problems.append("status is complete but user_confirmed is False")
    if state.user_confirmed and state.open_contradictions():
        problems.append("user confirmed while contradictions are still open")
    return problems


def ensure_valid(state: CaseState) -> None:
    problems = validate_case_state(state)
    if problems:
        raise ValueError("Invalid CaseState: " + "; ".join(problems))
