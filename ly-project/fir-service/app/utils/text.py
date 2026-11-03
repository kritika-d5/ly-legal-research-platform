"""
Small deterministic text helpers. Used as cheap, LLM-free safety nets:
if the model returns nothing for a short answer like "no" or "I don't know",
these let the conversation manager still interpret the reply correctly.
"""
from __future__ import annotations

import re
from typing import Optional

_DONT_KNOW = re.compile(
    r"\b(i\s*don'?t\s*(know|remember|recall)|not\s*sure|no\s*idea|can'?t\s*(remember|recall)|"
    r"unknown|i\s*have\s*no\s*idea|pata\s*nahi|nahi\s*pata|yaad\s*nahi|malum\s*nahi)\b",
    re.IGNORECASE,
)
_DECLINE = re.compile(
    r"\b(don'?t\s*want\s*to\s*(share|give|tell|say|provide|disclose)|prefer\s*not|"
    r"rather\s*not|won'?t\s*(share|give|tell)|skip\s*(this|that)|not\s*comfortable|"
    r"nahi\s*batana|nahi\s*dena)\b",
    re.IGNORECASE,
)
_YES = re.compile(r"^\s*(yes|yeah|yep|yup|correct|right|ha|haan|han|ji|sahi|theek|thik|ok|okay|confirm(ed)?|that'?s\s*(right|correct)|all\s*(good|correct)|looks\s*good)\b[\s.!]*$", re.IGNORECASE)
_NO = re.compile(r"^\s*(no|nope|nah|nahi|nahin|na|none|nothing|not\s*at\s*all|no\s*one|nobody)\b[\s.!,]*(.*)$", re.IGNORECASE)
_CONFIRM_PHRASES = re.compile(r"\b(yes|correct|confirm|that'?s\s*right|all\s*correct|looks\s*good|sahi\s*hai|theek\s*hai|haan)\b", re.IGNORECASE)
_CORRECTION_HINT = re.compile(r"\b(actually|not\s*\w+,|instead|correction|i\s*meant|sorry,?\s*it\s*was|change|wrong|galat|nahi,)\b", re.IGNORECASE)


def is_dont_know(text: str) -> bool:
    return bool(_DONT_KNOW.search(text or ""))


def is_decline(text: str) -> bool:
    return bool(_DECLINE.search(text or ""))


def yes_no(text: str) -> Optional[bool]:
    """Return True for a plain 'yes', False for a plain 'no', None otherwise."""
    t = (text or "").strip()
    if len(t) > 80:  # long answers are not plain yes/no
        return None
    if _YES.match(t):
        return True
    if _NO.match(t):
        return False
    return None


def looks_like_confirmation(text: str) -> bool:
    t = (text or "").strip()
    return len(t) <= 60 and bool(_CONFIRM_PHRASES.search(t)) and not _CORRECTION_HINT.search(t)


def looks_like_correction(text: str) -> bool:
    return bool(_CORRECTION_HINT.search(text or ""))


def normalize(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def token_overlap(a: str, b: str) -> float:
    """Jaccard similarity of word sets; 1.0 = identical, 0.0 = nothing in common."""
    ta, tb = set(normalize(a).split()), set(normalize(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
