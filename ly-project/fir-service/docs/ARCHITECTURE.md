# Architecture

## 1. What we are building

Part 1 is a **Conversational Legal Intake API**: a backend (plus a small UI) whose only job is to turn a
natural-language conversation about an incident into a strongly typed, legally neutral `CaseState`.
It answers the question *"what does the complainant say happened?"* — not *"which law applies?"*.

## 2. The central object: `CaseState`

Everything revolves around one Pydantic model, `CaseState` (`app/models/case_state.py`). The chatbot is
not "a conversation"; it is a loop whose purpose is to fill that object as completely and honestly as
possible, then get the user to confirm it.

Every leaf value is wrapped in a `Fact`:

```json
{"value": "20:00", "status": "explicit", "approximate": true, "description": "around 8 pm", "turn": 3, "history": []}
```

`status` is the provenance (who/what asserted this). This is what lets the system distinguish
"not mentioned" from "did not happen" from "user does not know" from "user refused".

## 3. Components and data flow

```
┌────────────┐   HTTP    ┌────────────────────────────────────────────────────────────────┐
│  frontend  │◄────────►│  FastAPI  (app/api/*)                                           │
│ (HTML/JS)  │           │     │                                                          │
└────────────┘           │     ▼                                                          │
                         │  ConversationManager  (app/conversation/manager.py)            │
                         │     │ 1. FactExtractor        LLM → ExtractedFacts (validated) │
                         │     │ 2. FactMerger           rules → CaseState                │
                         │     │ 3. ContradictionDetector rules (+ optional LLM)          │
                         │     │ 4. CompletenessChecker  rules → missing + %              │
                         │     │ 5. QuestionEngine       rules pick field, LLM phrases    │
                         │     │ 6. Summary + confirm    deterministic draft, LLM polish  │
                         │     ▼                                                          │
                         │  Repository (SQLite)   cases / messages / case_states          │
                         └────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │ LLMProvider interface (app/llm/base.py)
                         ┌────────────────┴───────────────────────────────┐
                         │ Groq | Gemini | Ollama | OpenAI-compatible | mock | demo │
                         └────────────────────────────────────────────────┘
```

### One conversational turn, step by step

1. **API** validates the request (`MessageRequest` rejects empty text) and calls the manager.
2. **Extraction** (`app/extraction/extractor.py`, prompt in `app/extraction/prompts.py`): the LLM
   receives the last few turns, a compact text view of what is already recorded, the last question
   asked, and the new message. It must return JSON matching `ExtractedFacts`. The provider layer parses,
   validates with Pydantic, retries once with the validation error on failure, and otherwise raises a
   clean `StructuredOutputError`.
3. **Short-answer safety net** (`manager._apply_short_answer_fallbacks`): if the model returned nothing
   for "no", "I don't know" or "I'd rather not say", small regexes interpret the reply against the last
   question so the conversation never loops.
4. **Merge** (`app/extraction/merger.py`): pure Python. For every fact: set if empty; ignore if identical;
   refine if vague→precise; combine wording for narrative fields; replace if the user declared a
   correction (history kept); otherwise **keep the old value and emit a `Conflict`**. Lists (accused,
   witnesses, property…) are matched by name/description to avoid duplicates. Relative dates are
   resolved against the case creation date (`app/utils/dates.py`).
5. **Contradictions** (`app/validation/contradictions.py`): conflicts become typed `Contradiction`
   records (direct / location / identity / event / relationship / timeline) with severity. Optionally a
   focused LLM prompt looks for timeline logic errors. Nothing is auto-resolved.
6. **Completeness** (`app/validation/completeness.py`): a table of ~35 rules, each with `applies(state)`,
   `resolved(state)`, a priority and a template question. Injury rules only apply if physical contact
   was described, property rules only if property was involved, and so on. Fields the user marked
   unknown/declined, or that were asked the maximum number of times, count as handled.
7. **Next action**: open contradiction → clarification question; ambiguous pronoun → clarification;
   nothing important missing (or question budget spent) → summary for review; otherwise the
   highest-priority missing field → question (LLM-phrased with guard rails, template fallback).
8. **Persist**: CaseState JSON + both messages are written to SQLite; the response carries the reply,
   `next_action`, completeness, open contradictions, a progress checklist and the full CaseState.

### Review and confirmation

When completeness says "nothing blocking is missing", the manager builds a deterministic summary
(every line comes from the CaseState) and optionally lets the LLM improve readability under an
"add nothing" instruction. Status becomes `awaiting_confirmation`. A confirming reply (or
`POST /confirm`) marks all explicit/extracted facts as `confirmed`, sets `user_confirmed=true` and
`status=complete`. Any correction reopens the case and the loop continues.

## 4. Technology choices and why

| Choice | Reason |
|---|---|
| **Python + FastAPI** | Async, automatic validation and OpenAPI docs, small learning curve |
| **Pydantic v2** | Typed models double as validation for LLM output and as the JSON contract |
| **Plain modules, no agent framework** | Every AI step is a visible class; easier to test, explain and grade than LangChain/LangGraph graphs; nothing here needs tool-calling loops |
| **Rules + LLM split** | Rules for anything checkable (completeness, merge, date maths, repetition); LLM only where language understanding is truly needed (extraction, phrasing). Cuts cost and hallucination surface |
| **Provider abstraction over HTTP with `httpx`** | Groq, Ollama, OpenRouter and LM Studio all speak the OpenAI chat format, so one class covers them; Gemini has its own; no vendor SDKs to install |
| **SQLite via a `Repository` interface** | Zero setup, survives restarts, and the interface makes a PostgreSQL implementation a drop-in |
| **CaseState stored as a JSON document** | Schema evolves freely during the project; `schema_version` tracks it |
| **Vanilla HTML/JS frontend** | No Node build step; demonstrates the API; a React/Next.js app can replace it using the same three endpoints |

## 5. Separation of "said" vs "inferred" vs "legal"

| Layer | Where | Example |
|---|---|---|
| What the user said | `Fact.status=explicit`, `description` keeps their words | `"around 8 pm"` |
| What the system inferred | `status=extracted`, `inferred_fields` from the model, derived flags | `"he" → Rahul` |
| What the law may say | **not in Part 1 at all** | BNS section → Part 2 |

## 6. Multilingual design

The extraction prompt accepts English, Hindi, Hinglish and other Indian languages and writes values in
English (names preserved). `CaseState.language` records the detected language. Question templates are
English; the LLM wording step is told to mirror the user's language style. Adding a language means
translating `RULES[*].question` templates and the intro/summary strings — the schema does not change.

## 7. Error handling and degradation

| Failure | Behaviour |
|---|---|
| LLM timeout / 429 / bad key | `LLMUnavailableError` → turn still completes with a template question and a `warning`; message saved; HTTP 503 only for endpoints that cannot proceed |
| Malformed JSON from model | one corrective retry → `StructuredOutputError` → warning + template question |
| Empty message | 422 from the API; soft message from the manager |
| Unknown case | 404 |
| Invalid CaseState detected | logged (never blocks the user); `validate_case_state()` also exposed for Part 2 |

## 8. Observability

`app/utils/logging.py` logs request id, case id, module, duration and error type. **User message
content is never logged** (only character counts).

## 9. Part 1 vs Part 2 boundary

| Part 1 (this repo) | Part 2 (later) |
|---|---|
| conversation, extraction, merge, contradictions, completeness, questions, summary, confirmation, storage, API, UI | BNS/IPC section recognition, legal RAG, court-case search & summarisation, FIR drafting & validation |
| input: user text · output: `CaseState` | input: `CaseState` · output: legal analysis / FIR |

Part 2 needs only `docs/CASE_STATE_SCHEMA.md`, `docs/PART2_HANDOFF.md` and the JSON from
`GET /cases/{id}/state`.

## 10. Swapping the database to PostgreSQL

`app/storage/repository.py` defines `Repository` with six methods. Implement `PostgresRepository`
(e.g. with `psycopg` or SQLAlchemy) using the same three tables, and return it from `get_repository()`
when `DATABASE_URL` starts with `postgresql://`. Nothing above the repository changes.
