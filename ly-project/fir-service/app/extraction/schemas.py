"""
ExtractedFacts - the JSON the extraction LLM must return for ONE user message.

Design rules:
* Every leaf is Optional. `null` means "the user did not say". The model is told
  never to guess.
* Dates and times are NOT computed by the model. It returns the user's words
  (`date_description="yesterday"`) and Python resolves them against the case
  creation date. The model may fill `date_iso` only when the user gave an
  explicit calendar date.
* `inferred_fields` and `uncertain_fields` let the model tell us which values
  are inferences (e.g. "he" -> Rahul) or ambiguous, so the merger can record
  provenance correctly.
* `unknown_fields` / `declined_fields` capture "I don't know" / "I'd rather not say".
* `corrections` capture "actually it was Thursday, not Wednesday".
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

YesNo = Optional[bool]


class ExtractedPerson(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    contact: Optional[str] = None
    relationship_to_other_party: Optional[str] = None
    other_details: Optional[str] = None

    @field_validator("age", mode="before")
    @classmethod
    def _age_to_int(cls, v):
        if v in (None, "", "null"):
            return None
        try:
            return int(str(v).strip().split()[0])
        except (ValueError, IndexError):
            return None


class ExtractedAccused(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None
    relationship_to_complainant: Optional[str] = None
    address_or_whereabouts: Optional[str] = None
    identity_status: Optional[Literal["known", "partially_known", "unknown"]] = None
    alleged_actions: List[str] = Field(default_factory=list)


class ExtractedIncident(BaseModel):
    date_iso: Optional[str] = None            # 'YYYY-MM-DD' ONLY if user gave an explicit date
    date_description: Optional[str] = None    # user's words: "yesterday", "last Thursday", "8 September"
    time_hhmm: Optional[str] = None           # 'HH:MM' 24h ONLY if user gave a clock time
    time_description: Optional[str] = None    # user's words: "evening", "around 8 pm", "night"
    location: Optional[str] = None
    location_details: Optional[str] = None
    description: Optional[str] = None         # one or two neutral sentences summarising the allegation
    ongoing_or_repeated: YesNo = None


class ExtractedAct(BaseModel):
    type: str = "other"                       # one of ActType values; validated leniently in merger
    description: str
    by: Optional[str] = None                  # name/alias/description of the person, or "unknown"
    against: Optional[str] = None


class ExtractedInjury(BaseModel):
    type: Optional[str] = None
    body_part: Optional[str] = None
    severity_as_described: Optional[str] = None
    treatment_received: YesNo = None
    hospital_or_doctor: Optional[str] = None
    medical_report_available: YesNo = None
    injured_person: Optional[str] = None


class ExtractedWeapon(BaseModel):
    object: Optional[str] = None
    description: Optional[str] = None
    used: YesNo = None
    how_used: Optional[str] = None


class ExtractedProperty(BaseModel):
    item: Optional[str] = None
    description: Optional[str] = None
    approximate_value: Optional[str] = None
    owner: Optional[str] = None
    what_happened: Optional[str] = None       # taken / damaged / lost / other
    recovered: YesNo = None
    force_or_threat_used: YesNo = None

    @field_validator("approximate_value", mode="before")
    @classmethod
    def _value_to_str(cls, v):
        return None if v is None else str(v)


class ExtractedWitness(BaseModel):
    name: Optional[str] = None
    relationship: Optional[str] = None
    contact: Optional[str] = None
    what_witnessed: Optional[str] = None


class ExtractedEvidence(BaseModel):
    type: str = "other"                       # one of EvidenceType values
    description: Optional[str] = None
    in_possession: YesNo = None
    reference: Optional[str] = None


class ExtractedTimelineEvent(BaseModel):
    time_description: Optional[str] = None
    description: str


class ExtractedFlags(BaseModel):
    injury_occurred: YesNo = None
    weapon_involved: YesNo = None
    property_involved: YesNo = None
    threat_involved: YesNo = None
    witnesses_present: YesNo = None
    evidence_available: YesNo = None
    police_informed_earlier: YesNo = None


class Correction(BaseModel):
    field: str                                # dotted path e.g. "incident.date", "accused.name"
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    quote: Optional[str] = None               # the user's words


class ExtractedFacts(BaseModel):
    """Top-level extraction result for one user message."""

    complainant: ExtractedPerson = Field(default_factory=ExtractedPerson)
    complainant_is_victim: YesNo = None
    victim: ExtractedPerson = Field(default_factory=ExtractedPerson)
    accused: List[ExtractedAccused] = Field(default_factory=list)
    incident: ExtractedIncident = Field(default_factory=ExtractedIncident)
    acts: List[ExtractedAct] = Field(default_factory=list)
    injuries: List[ExtractedInjury] = Field(default_factory=list)
    weapons: List[ExtractedWeapon] = Field(default_factory=list)
    property: List[ExtractedProperty] = Field(default_factory=list)
    witnesses: List[ExtractedWitness] = Field(default_factory=list)
    evidence: List[ExtractedEvidence] = Field(default_factory=list)
    timeline: List[ExtractedTimelineEvent] = Field(default_factory=list)
    flags: ExtractedFlags = Field(default_factory=ExtractedFlags)

    inferred_fields: List[str] = Field(default_factory=list)    # values the model inferred, not stated
    uncertain_fields: List[str] = Field(default_factory=list)   # ambiguous values
    unknown_fields: List[str] = Field(default_factory=list)     # user said "I don't know"
    declined_fields: List[str] = Field(default_factory=list)    # user refused to answer
    corrections: List[Correction] = Field(default_factory=list)
    denials: List[str] = Field(default_factory=list)            # things the user explicitly said did NOT happen
    ambiguous_references: List[str] = Field(default_factory=list)  # "'he' could be Rahul or the friend"
    user_intent: Optional[Literal["provide_information", "confirm", "correct", "ask_question", "other"]] = None
    detected_language: Optional[str] = None
    notes: Optional[str] = None

    def is_empty(self) -> bool:
        """True when the model found nothing at all."""
        d = self.model_dump(exclude_none=True)
        for k in ("inferred_fields", "uncertain_fields", "unknown_fields", "declined_fields",
                  "corrections", "denials", "ambiguous_references", "user_intent",
                  "detected_language", "notes"):
            d.pop(k, None)
        for section in ("complainant", "victim", "incident", "flags"):
            if section in d and not d[section]:
                d.pop(section)
        for section in ("accused", "acts", "injuries", "weapons", "property", "witnesses",
                        "evidence", "timeline"):
            if section in d and not d[section]:
                d.pop(section)
        return not d
