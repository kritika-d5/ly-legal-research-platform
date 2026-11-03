"""
Deterministic resolution of relative dates and vague times.

The LLM gives us the user's words ("yesterday", "last Thursday", "8 Sept").
This module turns them into ISO dates *when that is safe*, and otherwise keeps
them as approximate descriptions. Doing this in code (not in the model) means
the same input always yields the same output and nothing is hallucinated.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
    "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
HINDI_RELATIVE = {"kal": "yesterday", "aaj": "today", "parso": "day before yesterday"}


@dataclass
class ResolvedDate:
    iso: Optional[str]          # 'YYYY-MM-DD' or None
    approximate: bool
    description: Optional[str]  # the original words


def _valid_iso(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def resolve_date(date_iso: Optional[str], description: Optional[str], reference: date) -> ResolvedDate:
    """
    reference = the date the conversation happened (case creation date). "Yesterday" is
    relative to that, not to whenever the code runs later.
    """
    if date_iso and _valid_iso(date_iso):
        return ResolvedDate(iso=date_iso, approximate=False, description=description)

    if not description:
        return ResolvedDate(iso=None, approximate=False, description=None)

    text = description.strip().lower()
    for hi, en in HINDI_RELATIVE.items():
        if re.fullmatch(rf"{hi}( raat| shaam| subah| ko| din)?", text):
            text = en
            break

    exact_relative = {
        "today": 0, "tonight": 0, "this morning": 0, "this evening": 0, "this afternoon": 0,
        "yesterday": 1, "yesterday evening": 1, "yesterday night": 1, "yesterday morning": 1,
        "last night": 1, "yesterday afternoon": 1,
        "day before yesterday": 2, "the day before yesterday": 2,
    }
    if text in exact_relative:
        return ResolvedDate(iso=(reference - timedelta(days=exact_relative[text])).isoformat(),
                            approximate=False, description=description)

    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "a": 1, "couple of": 2}
    m = re.fullmatch(r"(?:about |around |some )?(\d+|one|two|three|four|five|six|seven|a|couple of)\s+days?\s+(?:ago|back|before)", text)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else words[m.group(1)]
        approx = text.startswith(("about", "around", "some")) or m.group(1) == "couple of"
        return ResolvedDate(iso=(reference - timedelta(days=n)).isoformat(), approximate=approx, description=description)

    # "last thursday" / "on thursday" / "thursday" -> most recent such weekday before reference
    m = re.fullmatch(r"(?:last |on |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: night| evening| morning| afternoon)?", text)
    if m:
        target = WEEKDAYS.index(m.group(1))
        delta = (reference.weekday() - target) % 7
        delta = 7 if delta == 0 else delta
        return ResolvedDate(iso=(reference - timedelta(days=delta)).isoformat(),
                            approximate=True, description=description)

    # "8 september", "8th sept 2026", "september 8", "8/9/2026"
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:\s+(\d{4}))?", text)
    if m and m.group(2) in MONTHS:
        day, month = int(m.group(1)), MONTHS[m.group(2)]
        year = int(m.group(3)) if m.group(3) else reference.year
        try:
            d = date(year, month, day)
            if not m.group(3) and d > reference:
                d = date(year - 1, month, day)
            return ResolvedDate(iso=d.isoformat(), approximate=not bool(m.group(3)), description=description)
        except ValueError:
            pass
    m = re.search(r"([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?", text)
    if m and m.group(1) in MONTHS:
        day, month = int(m.group(2)), MONTHS[m.group(1)]
        year = int(m.group(3)) if m.group(3) else reference.year
        try:
            d = date(year, month, day)
            if not m.group(3) and d > reference:
                d = date(year - 1, month, day)
            return ResolvedDate(iso=d.isoformat(), approximate=not bool(m.group(3)), description=description)
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", text)
    if m:  # Indian convention: day/month/year
        try:
            d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            return ResolvedDate(iso=d.isoformat(), approximate=False, description=description)
        except ValueError:
            pass

    # Anything else ("recently", "last week", "some days ago") stays approximate.
    return ResolvedDate(iso=None, approximate=True, description=description)


@dataclass
class ResolvedTime:
    hhmm: Optional[str]
    approximate: bool
    description: Optional[str]


def _valid_hhmm(s: str) -> bool:
    return bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", s))


def resolve_time(time_hhmm: Optional[str], description: Optional[str]) -> ResolvedTime:
    approx_words = ("around", "about", "approximately", "roughly", "near", "ish", "lagbhag", "karib", "kareeb")
    desc_l = (description or "").lower()
    is_approx = any(w in desc_l for w in approx_words)

    if time_hhmm and _valid_hhmm(time_hhmm):
        return ResolvedTime(hhmm=time_hhmm, approximate=is_approx, description=description)

    if not description:
        return ResolvedTime(hhmm=None, approximate=False, description=None)

    # A range ("between 8 and 8:30", "4 to 6 pm", "8-9") is not a single time: keep it approximate.
    if re.search(r"\bbetween\b|\b\d{1,2}(?::\d{2})?\s*(?:to|-|–|and)\s*\d{1,2}(?::\d{2})?\b", desc_l):
        return ResolvedTime(hhmm=None, approximate=True, description=description)

    # Parse "8 pm", "8:30pm", "20:00", "8 baje" from the description ourselves.
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b", desc_l)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2) or 0)
        if m.group(3).startswith("p") and hour != 12:
            hour += 12
        if m.group(3).startswith("a") and hour == 12:
            hour = 0
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return ResolvedTime(hhmm=f"{hour:02d}:{minute:02d}", approximate=is_approx, description=description)
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", desc_l)
    if m:
        return ResolvedTime(hhmm=f"{int(m.group(1)):02d}:{m.group(2)}", approximate=is_approx, description=description)

    # "evening", "night", "morning", "afternoon", "raat", "shaam" -> approximate only
    return ResolvedTime(hhmm=None, approximate=True, description=description)
