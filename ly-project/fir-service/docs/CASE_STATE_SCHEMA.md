# CaseState Schema (v1.0) — the Part 1 → Part 2 contract

Source of truth: `app/models/case_state.py`. Machine-readable JSON Schema:
`python -c "from app.models.case_state import CaseState; import json; print(json.dumps(CaseState.model_json_schema(), indent=2))"`.

## 1. The `Fact` wrapper

Every scalar piece of information is a `Fact` object, never a bare value:

| Field | Type | Meaning |
|---|---|---|
| `value` | string / int / bool / null | normalised value. `null` when unknown, not provided, declined, or only approximately known |
| `status` | enum | provenance — see table below |
| `approximate` | bool | the user gave a vague value ("evening", "last week", "around 8") |
| `description` | string / null | the user's own words, kept for approximate/uncertain facts |
| `turn` | int / null | user-message number in which this was (last) stated |
| `history` | list of objects | previous values with `reason` = `refined` / `corrected` / `elaborated` / `derived` |

### `status` values (FactStatus)

| status | meaning | Part 2 should treat as |
|---|---|---|
| `explicit` | user stated it directly | reliable allegation |
| `extracted` | system inferred it from wording (e.g. "he" → named person, flag derived from a described injury) | probably true, lower confidence |
| `confirmed` | user confirmed the final summary containing it | reliable allegation |
| `uncertain` | ambiguous wording ("around 8 pm", "I think it was Rahul") | use with caution |
| `unknown` | user said they do not know | **absence of knowledge, not absence of fact** |
| `declined` | user refused to provide | do not infer anything |
| `not_provided` | never mentioned / never asked | do not infer anything |

Helpers used across the code: `is_answered` (has real information), `is_resolved` (no need to ask again).

Conventions: `incident.date.value` is `YYYY-MM-DD`; `incident.time.value` is `HH:MM` (24h). Money is kept as
free text (`"around 20,000 rupees"`) because users rarely give exact figures.

## 2. Top level

| Field | Type | Description |
|---|---|---|
| `schema_version` | string | `"1.0"` |
| `case_id` | string | `case_` + 10 hex chars; primary key everywhere |
| `created_at`, `updated_at` | ISO-8601 UTC strings | relative dates ("yesterday") were resolved against `created_at` |
| `status` | `in_progress` / `awaiting_confirmation` / `complete` | Part 2 should only consume `complete` cases |
| `language` | string | detected conversation language (`en`, `hi`, `hi-en`…). Values inside facts are English |
| `turn_count` | int | number of user messages processed |
| `questions_asked` | int | follow-up questions asked |
| `complainant` | Person | the person reporting |
| `complainant_is_victim` | Fact[bool] | `true` = complainant is the person harmed; `false` = reporting on behalf of `victim` |
| `victim` | Person | filled only when `complainant_is_victim` is false |
| `accused` | list of Accused | 0..n persons alleged to be involved (may be unidentified) |
| `incident` | Incident | when/where/what |
| `acts` | list of Act | individual alleged actions (factual categories) |
| `injuries` | list of Injury | |
| `weapons` | list of Weapon | objects used or shown |
| `property` | list of PropertyItem | taken / damaged / lost items |
| `witnesses` | list of Witness | |
| `evidence` | list of Evidence | metadata only |
| `timeline` | list of TimelineEvent | ordered events |
| `flags` | ContextFlags | yes/no context facts (each a Fact[bool]) |
| `contradictions` | list of Contradiction | every inconsistency found, resolved or not |
| `missing_information` | list of MissingInformation | what was still missing at last check (usually only optional items when complete) |
| `completion_percentage` | int 0–100 | weighted share of applicable fields handled |
| `asked_questions` | list of AskedQuestion | audit trail of questions (field, wording, turn, times) |
| `declined_fields` | list of string | dotted paths the user refused |
| `unknown_fields` | list of string | dotted paths the user does not know |
| `pending_clarification` | string / null | contradiction id currently being clarified (internal) |
| `user_confirmed` | bool | user approved the final summary |
| `final_summary` | string / null | the human-readable summary shown to the user |
| `notes` | list of string | system observations, e.g. explicit denials ("turn 3: user denied - not injured") |

## 3. Sub-objects

### Person (`complainant`, `victim`)
`name` Fact[str] · `age` Fact[int] · `gender` Fact[str] · `address` Fact[str] · `contact` Fact[str] ·
`relationship_to_other_party` Fact[str] (victim→complainant or complainant→victim) · `other_details` Fact[str]

### Accused
| Field | Type | Notes |
|---|---|---|
| `accused_id` | string | `acc_xxxxxx`, stable within the case |
| `identity_status` | `known` / `partially_known` / `unknown` / `not_provided` | `unknown` = user does not know who it was — **never force a name** |
| `name`, `alias`, `description` | Fact[str] | description = appearance/clothing etc. |
| `relationship_to_complainant` | Fact[str] | free text as stated ("neighbour", "classmate", "stranger") |
| `address_or_whereabouts` | Fact[str] | |
| `alleged_actions` | list of string | short factual phrases attributed to this person |

`Accused.label()` gives a display handle: the name, or `person known as 'X'`, or `unidentified person (description)`.

### Incident
`date` Fact[str, YYYY-MM-DD] · `time` Fact[str, HH:MM] · `location` Fact[str] · `location_details` Fact[str] ·
`description` Fact[str] (neutral narrative built from the user's statements) · `ongoing_or_repeated` Fact[bool]

### Act
| Field | Type | Notes |
|---|---|---|
| `act_id` | string | |
| `type` | ActType | `physical_assault`, `threat`, `verbal_abuse`, `harassment`, `taking_property`, `property_damage`, `entering_premises`, `cheating_or_fraud`, `stalking_or_following`, `online_or_message_based`, `other` — **factual categories, not offences** |
| `description` | string | "pushed the user", "took the user's phone" |
| `by` | string / null | accused label or `"unknown"` |
| `against` | string / null | `"complainant"` or a name |
| `status` | FactStatus | |
| `turn` | int | |

### Injury
`type`, `body_part`, `severity_as_described`, `hospital_or_doctor`, `injured_person` (Fact[str]);
`treatment_received`, `medical_report_available` (Fact[bool]). Never invented; only what the user said.

### Weapon
`object` Fact[str] ("stick") · `description` · `used` Fact[bool] (used vs merely shown) · `how_used` Fact[str]

### PropertyItem
`item`, `description`, `approximate_value` (text), `owner`, `what_happened` ("taken" / "damaged" / "lost") (Fact[str]);
`recovered`, `force_or_threat_used` (Fact[bool])

### Witness
`name`, `relationship`, `contact` (only if volunteered), `what_witnessed` (Fact[str])

### Evidence
`type` EvidenceType (`cctv`, `photograph`, `video`, `audio`, `messages`, `email`, `document`, `medical_report`,
`bill_or_receipt`, `call_records`, `other`) · `description` · `in_possession` Fact[bool] (does the user hold it) · `reference` Fact[str]

### TimelineEvent
`sequence` int (1-based) · `time_description` string/null ("20:00", "after the argument") · `description` · `turn`

### ContextFlags (each Fact[bool]; `null` value with `not_provided` = not asked yet)
`injury_occurred`, `weapon_involved`, `property_involved`, `threat_involved`, `witnesses_present`,
`evidence_available`, `police_informed_earlier`

### Contradiction
| Field | Notes |
|---|---|
| `contradiction_id` | `ctr_xxxxxx` |
| `type` | `direct` / `location` / `identity` / `event` / `timeline` / `relationship` / `other` |
| `field` | dotted path, e.g. `incident.time`, `accused.identity`, `flags.injury_occurred` |
| `earlier_value`, `later_value`, `earlier_turn`, `later_turn` | the two statements |
| `explanation` | neutral sentence |
| `severity` | `low` / `medium` / `high` |
| `requires_clarification` | true until asked |
| `resolved` | true after the user answered |
| `resolution` | the user's clarifying words |

A `complete` case never has `resolved=false` contradictions (the confirm step refuses otherwise).

### MissingInformation
`field` · `priority` (`high`/`medium`/`low`/`optional`) · `reason` · `suggested_question`

### AskedQuestion
`field` · `question` · `turn` · `times_asked`

## 4. Reading the state safely (for Part 2)

```python
from app.models.case_state import CaseState, FactStatus
state = CaseState.from_json(open("case.json").read())

if state.status.value != "complete":
    raise ValueError("only consume confirmed cases")

for a in state.accused:
    print(a.label(), a.identity_status.value)          # never assume a name exists

t = state.incident.time
if t.value:            print("time", t.value, "(approx)" if t.approximate else "")
elif t.approximate:    print("time approx:", t.description)
elif t.status == FactStatus.UNKNOWN: print("user does not know the time")
else:                  print("time not provided")

injured = state.flags.injury_occurred
# injured.value is True / False / None  -> None means NOT ASKED, not "no injury"
```

## 5. Versioning

Breaking changes bump `SCHEMA_VERSION` in `app/models/case_state.py`; additive changes (new optional
fields) keep the version. Part 2 should check `schema_version` and reject unknown majors.
