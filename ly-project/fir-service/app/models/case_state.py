"""
CaseState - the single source of truth for Part 1.

WHAT IS PYDANTIC?
-----------------
Pydantic lets us describe the *shape* of our data as Python classes. Each
class is a "model"; each attribute has a type. When data comes in (from the
LLM, the database, or an HTTP request) Pydantic checks it against the model and
raises an error if it does not fit. It also converts models to/from JSON
("serialization"). That means a corrupted or hallucinated structure from the
LLM can never silently enter our CaseState.

THE PROVENANCE IDEA
-------------------
Every *fact* in the case is wrapped in a `Fact` object that records not just the
value but HOW we know it (`status`). This lets us distinguish:

    "user never mentioned the time"     -> status = not_provided
    "user said they don't remember"     -> status = unknown
    "user declined to share address"    -> status = declined
    "user said 'around evening'"        -> value=None, approximate=True, description="evening"
    "user said '8 PM'"                  -> value="20:00", status = explicit
    "LLM inferred 'he' means Rahul"     -> status = extracted (system inference)
    "user later confirmed"              -> status = confirmed

The system must NEVER confuse "not mentioned" with "did not happen".
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"


# ---------------------------------------------------------------------------
# Enumerations (controlled vocabularies)
# ---------------------------------------------------------------------------
class FactStatus(str, Enum):
    """How we came to know a fact (provenance)."""

    EXPLICIT = "explicit"          # user stated it directly
    EXTRACTED = "extracted"        # system inferred it from the user's wording
    CONFIRMED = "confirmed"        # user confirmed a system-extracted value
    UNCERTAIN = "uncertain"        # ambiguous; needs clarification
    UNKNOWN = "unknown"            # user said they do not know
    DECLINED = "declined"          # user refused to provide
    NOT_PROVIDED = "not_provided"  # never asked / never mentioned


class CaseStatus(str, Enum):
    IN_PROGRESS = "in_progress"                    # still collecting facts
    AWAITING_CONFIRMATION = "awaiting_confirmation"  # summary shown, waiting for user review
    COMPLETE = "complete"                          # user confirmed; ready for Part 2


class IdentityStatus(str, Enum):
    KNOWN = "known"                      # user can name the person
    PARTIALLY_KNOWN = "partially_known"  # description / alias only
    UNKNOWN = "unknown"                  # user does not know who it was
    NOT_PROVIDED = "not_provided"


class ActType(str, Enum):
    """Factual descriptions of what allegedly happened. NOT legal classifications."""

    PHYSICAL_ASSAULT = "physical_assault"
    THREAT = "threat"
    VERBAL_ABUSE = "verbal_abuse"
    HARASSMENT = "harassment"
    TAKING_PROPERTY = "taking_property"
    PROPERTY_DAMAGE = "property_damage"
    ENTERING_PREMISES = "entering_premises"
    CHEATING_OR_FRAUD = "cheating_or_fraud"
    STALKING_OR_FOLLOWING = "stalking_or_following"
    ONLINE_OR_MESSAGE_BASED = "online_or_message_based"
    OTHER = "other"


class Relationship(str, Enum):
    NEIGHBOUR = "neighbour"
    LANDLORD = "landlord"
    TENANT = "tenant"
    SPOUSE = "spouse"
    FAMILY_MEMBER = "family_member"
    EMPLOYER = "employer"
    EMPLOYEE = "employee"
    COLLEAGUE = "colleague"
    FRIEND = "friend"
    ACQUAINTANCE = "acquaintance"
    CLASSMATE = "classmate"
    STRANGER = "stranger"
    UNKNOWN = "unknown"
    OTHER = "other"


class EvidenceType(str, Enum):
    CCTV = "cctv"
    PHOTOGRAPH = "photograph"
    VIDEO = "video"
    AUDIO = "audio"
    MESSAGES = "messages"
    EMAIL = "email"
    DOCUMENT = "document"
    MEDICAL_REPORT = "medical_report"
    BILL_OR_RECEIPT = "bill_or_receipt"
    CALL_RECORDS = "call_records"
    OTHER = "other"


class Priority(str, Enum):
    HIGH = "high"        # Priority 1: core incident facts
    MEDIUM = "medium"    # Priority 2: immediate factual details
    LOW = "low"          # Priority 3: supporting information
    OPTIONAL = "optional"  # Priority 4


class ContradictionType(str, Enum):
    DIRECT = "direct"              # 8 PM vs 10 PM
    LOCATION = "location"
    IDENTITY = "identity"
    EVENT = "event"                # "no injury" vs hospital treatment
    TIMELINE = "timeline"
    RELATIONSHIP = "relationship"
    OTHER = "other"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# ---------------------------------------------------------------------------
# The Fact wrapper
# ---------------------------------------------------------------------------
T = TypeVar("T")


class Fact(BaseModel, Generic[T]):
    """
    A single piece of information plus its provenance.

    `value`        the normalised value (None if unknown / not provided / approximate-only)
    `status`       how we know it (see FactStatus)
    `approximate`  True when the user gave a vague value ("evening", "last week")
    `description`  the user's own words, kept verbatim for approximate/uncertain facts
    `turn`         conversation turn (message number) where this was stated
    `history`      previous values if the user corrected themselves
    """

    model_config = ConfigDict(use_enum_values=False)

    value: Optional[T] = None
    status: FactStatus = FactStatus.NOT_PROVIDED
    approximate: bool = False
    description: Optional[str] = None
    turn: Optional[int] = None
    history: List[dict] = Field(default_factory=list)

    # -- convenience helpers used throughout the code --
    @property
    def is_resolved(self) -> bool:
        """True if we should stop asking about this fact."""
        return self.status != FactStatus.NOT_PROVIDED

    @property
    def has_value(self) -> bool:
        return self.value is not None or (self.approximate and bool(self.description))

    @property
    def is_answered(self) -> bool:
        """Has real information (a value or an approximate description)."""
        return self.status in {
            FactStatus.EXPLICIT,
            FactStatus.EXTRACTED,
            FactStatus.CONFIRMED,
            FactStatus.UNCERTAIN,
        } and self.has_value

    def display(self) -> str:
        if self.value is not None:
            text = str(self.value)
            if self.approximate:
                text += " (approx.)"
            return text
        if self.approximate and self.description:
            return f"{self.description} (approx.)"
        if self.status == FactStatus.UNKNOWN:
            return "not known to complainant"
        if self.status == FactStatus.DECLINED:
            return "declined to share"
        return "not provided"


def empty_fact() -> Fact:
    return Fact()


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
class Person(BaseModel):
    """Used for both complainant and victim."""

    name: Fact[str] = Field(default_factory=Fact)
    age: Fact[int] = Field(default_factory=Fact)
    gender: Fact[str] = Field(default_factory=Fact)
    address: Fact[str] = Field(default_factory=Fact)
    contact: Fact[str] = Field(default_factory=Fact)
    # For the victim: relationship to complainant. For complainant: relationship to victim.
    relationship_to_other_party: Fact[str] = Field(default_factory=Fact)
    other_details: Fact[str] = Field(default_factory=Fact)


class Accused(BaseModel):
    """
    A person the complainant alleges was involved. Supports known, partially
    identified, and unknown persons. Multiple accused are stored as a list.
    """

    accused_id: str = Field(default_factory=lambda: "acc_" + uuid.uuid4().hex[:6])
    identity_status: IdentityStatus = IdentityStatus.NOT_PROVIDED
    name: Fact[str] = Field(default_factory=Fact)
    alias: Fact[str] = Field(default_factory=Fact)
    description: Fact[str] = Field(default_factory=Fact)   # appearance, clothing, etc.
    relationship_to_complainant: Fact[str] = Field(default_factory=Fact)
    address_or_whereabouts: Fact[str] = Field(default_factory=Fact)
    alleged_actions: List[str] = Field(default_factory=list)  # short factual descriptions

    def label(self) -> str:
        """Human readable handle, e.g. 'Rahul' or 'unidentified person (tall man in red shirt)'."""
        if self.name.value:
            return str(self.name.value)
        if self.alias.value:
            return f"person known as '{self.alias.value}'"
        if self.description.value:
            return f"unidentified person ({self.description.value})"
        return "unidentified person"


# ---------------------------------------------------------------------------
# Incident
# ---------------------------------------------------------------------------
class Incident(BaseModel):
    """
    `date.value` is an ISO date string 'YYYY-MM-DD' when known.
    `time.value` is 'HH:MM' (24h) when known. For vague answers the value stays
    None and `approximate=True, description='evening'`.
    """

    date: Fact[str] = Field(default_factory=Fact)
    time: Fact[str] = Field(default_factory=Fact)
    location: Fact[str] = Field(default_factory=Fact)          # "near Dadar railway station"
    location_details: Fact[str] = Field(default_factory=Fact)  # landmark, floor, room, etc.
    description: Fact[str] = Field(default_factory=Fact)       # narrative summary of what happened
    ongoing_or_repeated: Fact[bool] = Field(default_factory=Fact)


class Act(BaseModel):
    """One alleged action. Factual, not legal."""

    act_id: str = Field(default_factory=lambda: "act_" + uuid.uuid4().hex[:6])
    type: ActType = ActType.OTHER
    description: str                       # "pushed the complainant"
    by: Optional[str] = None               # accused label / name / "unknown"
    against: Optional[str] = None          # victim label / "complainant"
    status: FactStatus = FactStatus.EXPLICIT
    turn: Optional[int] = None


class Injury(BaseModel):
    injury_id: str = Field(default_factory=lambda: "inj_" + uuid.uuid4().hex[:6])
    type: Fact[str] = Field(default_factory=Fact)          # bruise, cut, fracture (as described)
    body_part: Fact[str] = Field(default_factory=Fact)
    severity_as_described: Fact[str] = Field(default_factory=Fact)
    treatment_received: Fact[bool] = Field(default_factory=Fact)
    hospital_or_doctor: Fact[str] = Field(default_factory=Fact)
    medical_report_available: Fact[bool] = Field(default_factory=Fact)
    injured_person: Fact[str] = Field(default_factory=Fact)  # "complainant" / name


class Weapon(BaseModel):
    weapon_id: str = Field(default_factory=lambda: "wpn_" + uuid.uuid4().hex[:6])
    object: Fact[str] = Field(default_factory=Fact)       # "stick", "knife", "stone"
    description: Fact[str] = Field(default_factory=Fact)
    used: Fact[bool] = Field(default_factory=Fact)        # actually used vs only shown
    how_used: Fact[str] = Field(default_factory=Fact)


class PropertyItem(BaseModel):
    property_id: str = Field(default_factory=lambda: "prp_" + uuid.uuid4().hex[:6])
    item: Fact[str] = Field(default_factory=Fact)                 # "mobile phone"
    description: Fact[str] = Field(default_factory=Fact)          # "black Samsung, IMEI ..."
    approximate_value: Fact[str] = Field(default_factory=Fact)    # kept as text: "about 20,000 rupees"
    owner: Fact[str] = Field(default_factory=Fact)
    what_happened: Fact[str] = Field(default_factory=Fact)        # "taken" / "damaged" / "lost"
    recovered: Fact[bool] = Field(default_factory=Fact)
    force_or_threat_used: Fact[bool] = Field(default_factory=Fact)


class Witness(BaseModel):
    witness_id: str = Field(default_factory=lambda: "wit_" + uuid.uuid4().hex[:6])
    name: Fact[str] = Field(default_factory=Fact)
    relationship: Fact[str] = Field(default_factory=Fact)
    contact: Fact[str] = Field(default_factory=Fact)
    what_witnessed: Fact[str] = Field(default_factory=Fact)


class Evidence(BaseModel):
    evidence_id: str = Field(default_factory=lambda: "evd_" + uuid.uuid4().hex[:6])
    type: EvidenceType = EvidenceType.OTHER
    description: Fact[str] = Field(default_factory=Fact)
    in_possession: Fact[bool] = Field(default_factory=Fact)  # does the user have it?
    reference: Fact[str] = Field(default_factory=Fact)       # file name / URL / where it is held


class TimelineEvent(BaseModel):
    sequence: int
    time_description: Optional[str] = None  # "20:00" or "after the argument"
    description: str
    turn: Optional[int] = None


# ---------------------------------------------------------------------------
# Yes/No context flags. Each is a Fact[bool] so that "not asked" (not_provided),
# "user doesn't know" (unknown) and "No" (value False) stay distinct.
# ---------------------------------------------------------------------------
class ContextFlags(BaseModel):
    injury_occurred: Fact[bool] = Field(default_factory=Fact)
    weapon_involved: Fact[bool] = Field(default_factory=Fact)
    property_involved: Fact[bool] = Field(default_factory=Fact)
    threat_involved: Fact[bool] = Field(default_factory=Fact)
    witnesses_present: Fact[bool] = Field(default_factory=Fact)
    evidence_available: Fact[bool] = Field(default_factory=Fact)
    police_informed_earlier: Fact[bool] = Field(default_factory=Fact)


# ---------------------------------------------------------------------------
# Validation bookkeeping
# ---------------------------------------------------------------------------
class Contradiction(BaseModel):
    contradiction_id: str = Field(default_factory=lambda: "ctr_" + uuid.uuid4().hex[:6])
    type: ContradictionType = ContradictionType.OTHER
    field: str                            # dotted path, e.g. "incident.time"
    earlier_value: Optional[str] = None
    later_value: Optional[str] = None
    earlier_turn: Optional[int] = None
    later_turn: Optional[int] = None
    explanation: str = ""
    severity: Severity = Severity.MEDIUM
    requires_clarification: bool = True
    resolved: bool = False
    resolution: Optional[str] = None      # what the user said when clarifying


class MissingInformation(BaseModel):
    field: str                # dotted path, e.g. "incident.location"
    priority: Priority
    reason: str = ""          # why it is relevant ("injury was mentioned")
    suggested_question: str = ""


class AskedQuestion(BaseModel):
    """Memory of what we already asked, to avoid repetition."""

    field: str
    question: str
    turn: int
    times_asked: int = 1


# ---------------------------------------------------------------------------
# The CaseState itself
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CaseState(BaseModel):
    """
    Complete structured record of one intake conversation.
    This exact structure (as JSON) is the contract handed to Part 2.
    """

    schema_version: str = SCHEMA_VERSION
    case_id: str = Field(default_factory=lambda: "case_" + uuid.uuid4().hex[:10])
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    status: CaseStatus = CaseStatus.IN_PROGRESS
    language: str = "en"               # language of the conversation (internal facts stay English)
    turn_count: int = 0                # number of user messages processed
    questions_asked: int = 0

    complainant: Person = Field(default_factory=Person)
    complainant_is_victim: Fact[bool] = Field(default_factory=Fact)
    victim: Person = Field(default_factory=Person)

    accused: List[Accused] = Field(default_factory=list)
    incident: Incident = Field(default_factory=Incident)
    acts: List[Act] = Field(default_factory=list)
    injuries: List[Injury] = Field(default_factory=list)
    weapons: List[Weapon] = Field(default_factory=list)
    property: List[PropertyItem] = Field(default_factory=list)
    witnesses: List[Witness] = Field(default_factory=list)
    evidence: List[Evidence] = Field(default_factory=list)
    timeline: List[TimelineEvent] = Field(default_factory=list)
    flags: ContextFlags = Field(default_factory=ContextFlags)

    contradictions: List[Contradiction] = Field(default_factory=list)
    missing_information: List[MissingInformation] = Field(default_factory=list)
    completion_percentage: int = 0
    asked_questions: List[AskedQuestion] = Field(default_factory=list)
    declined_fields: List[str] = Field(default_factory=list)
    unknown_fields: List[str] = Field(default_factory=list)

    pending_clarification: Optional[str] = None   # contradiction_id we are currently asking about
    user_confirmed: bool = False
    final_summary: Optional[str] = None
    notes: List[str] = Field(default_factory=list)   # free-text observations by the system

    # ---- helpers ----
    def touch(self) -> None:
        self.updated_at = _now_iso()

    def open_contradictions(self) -> List[Contradiction]:
        return [c for c in self.contradictions if c.requires_clarification and not c.resolved]

    def find_accused(self, name_or_label: Optional[str]) -> Optional[Accused]:
        if not name_or_label:
            return None
        key = name_or_label.strip().lower()
        for a in self.accused:
            if a.name.value and a.name.value.strip().lower() == key:
                return a
            if a.alias.value and a.alias.value.strip().lower() == key:
                return a
            if a.accused_id == key:
                return a
        return None

    def to_json(self, indent: int = 2) -> str:
        return self.model_dump_json(indent=indent)

    @classmethod
    def from_json(cls, data: str | bytes | dict[str, Any]) -> "CaseState":
        if isinstance(data, dict):
            return cls.model_validate(data)
        return cls.model_validate_json(data)
