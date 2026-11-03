# FIR Intake Assistant — Part 1: Conversational Legal Intake API

An AI-assisted chatbot that helps a person describe an incident in their own words and turns the
conversation into a **structured, legally neutral `CaseState` JSON** that a later module (Part 2:
legal section recognition, legal RAG, FIR drafting) can consume.

> **Academic prototype.** This software organises information a user provides. It does not determine
> guilt, does not give legal advice, does not classify offences, and does not replace the police or a
> lawyer. Anything it produces must be reviewed by a qualified person before any official use.

---

## What Part 1 does

```
USER describes incident  ──►  LLM extracts FACTS (never legal conclusions)
                              ──►  deterministic MERGE into CaseState
                              ──►  CONTRADICTION check
                              ──►  COMPLETENESS check (rules, context-aware)
                              ──►  next QUESTION (one at a time, dynamic)
                              ──►  ... repeat ...
                              ──►  human-readable SUMMARY  ──►  user CONFIRMS
                              ──►  final CaseState JSON  ──►  handed to Part 2
```

Key properties:

| Property | How it is achieved |
|---|---|
| Never invents facts | Strict extraction prompt + every value is `null` unless stated; relative dates ("yesterday") are resolved by code, not the model |
| Preserves uncertainty | Every fact carries a `status` (explicit / extracted / confirmed / uncertain / unknown / declined / not_provided) and an `approximate` flag |
| Dynamic questioning | A rule table decides *which* field matters next given what is already known; the LLM only *phrases* the question |
| Contradictions are surfaced, never auto-resolved | Merge conflicts become clarification questions; the user's answer is recorded |
| Legally neutral | No IPC/BNS sections, no "offender" language; acts are factual categories (`physical_assault`, `taking_property`, …) |
| Works without paying | Groq free tier (default), Gemini free tier, local Ollama, or a zero-key `demo` mode |

## Repository layout

```
ly project/
├── app/                      backend (FastAPI)
│   ├── main.py               app entry point, CORS, static frontend
│   ├── config.py             settings from .env
│   ├── api/                  HTTP endpoints
│   ├── models/               CaseState (Pydantic) + request/response models
│   ├── conversation/         manager (orchestrator), question engine, summary, prompts
│   ├── extraction/           LLM fact extraction schema/prompt + deterministic merger
│   ├── validation/           completeness rules, contradiction detector, validators
│   ├── llm/                  provider abstraction (Groq/Gemini/Ollama/OpenAI-compatible/mock/demo)
│   ├── storage/              SQLite repository
│   └── utils/                dates, text helpers, logging
├── frontend/                 vanilla HTML/JS chat UI (served by FastAPI at /)
├── tests/                    pytest suite (unit + integration + API + optional live-LLM)
├── data/sample_cases/        synthetic scenarios + 19 example CaseState JSON files
├── evaluation/               metrics harness (run_eval.py) and reports
├── docs/                     architecture, schema, API, prompts, setup, evaluation, Part 2 handoff
├── demo.py                   presentation demo (offline or live)
├── requirements.txt, .env.example, .gitignore, pytest.ini
```

## Quick start (5 minutes)

```bash
# 1. create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. install dependencies
pip install -r requirements.txt

# 3. configure
cp .env.example .env               # then edit .env (see below)

# 4. run the backend + UI
uvicorn app.main:app --reload
# open http://localhost:8000        (chat UI)
# open http://localhost:8000/docs   (interactive API docs)
```

### Choosing a (free) LLM

Edit `.env`:

| `LLM_PROVIDER` | Cost | What to set | Get a key |
|---|---|---|---|
| `groq` (recommended) | free tier | `LLM_API_KEY=gsk_...`, `LLM_MODEL=openai/gpt-oss-120b` | https://console.groq.com/keys |
| `gemini` | free tier | `LLM_API_KEY=AIza...`, `LLM_MODEL=gemini-2.0-flash` | https://aistudio.google.com/apikey |
| `ollama` | free, local | install Ollama, `ollama pull llama3.1:8b`, `LLM_MODEL=llama3.1:8b` | — |
| `openai_compatible` | varies | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (e.g. OpenRouter `:free` models) | provider site |
| `demo` | none | nothing else needed; replays the synthetic scenarios | — |

Full explanation of every variable: [docs/SETUP.md](docs/SETUP.md).

## Try it without any key

```bash
python demo.py                       # scripted conversation, prints extracted facts + questions + final JSON
python demo.py --list                # other scenarios
python demo.py --scenario theft_unknown_accused
python demo.py --interactive         # type answers yourself (needs a real provider in .env)
```

## Run the tests

```bash
pytest                    # 52 offline tests, no network needed
pytest tests/test_live_llm.py -v   # real-LLM tests; skipped automatically unless .env has a key
```

## Evaluate

```bash
python -m evaluation.run_eval          # deterministic pipeline against reference extractions
python -m evaluation.run_eval --live   # also measures the real LLM's extraction quality
```
Metrics and methodology: [docs/EVALUATION.md](docs/EVALUATION.md).

## API at a glance

| Method | Path | Purpose |
|---|---|---|
| POST | `/cases` | start a case; returns the intro message |
| POST | `/cases/{id}/messages` | send one user message; returns reply, next_action, CaseState, completeness |
| GET | `/cases/{id}` | overview + transcript + progress |
| GET | `/cases/{id}/state` | the full CaseState JSON (Part 2 input) |
| GET | `/cases/{id}/completeness` | what is still missing, prioritised |
| GET | `/cases/{id}/summary` | human-readable review summary |
| POST | `/cases/{id}/confirm` | user confirms (→ `complete`) or reopens |
| GET | `/cases` | list recent cases |

Examples with request/response bodies: [docs/API.md](docs/API.md).

## The CaseState contract (Part 2 input)

Top-level shape (every leaf fact is `{value, status, approximate, description, turn, history}`):

```json
{
  "schema_version": "1.0", "case_id": "case_…", "status": "complete", "user_confirmed": true,
  "complainant": {}, "complainant_is_victim": {}, "victim": {},
  "accused": [], "incident": {}, "acts": [], "injuries": [], "weapons": [], "property": [],
  "witnesses": [], "evidence": [], "timeline": [], "flags": {},
  "contradictions": [], "missing_information": [], "completion_percentage": 100,
  "unknown_fields": [], "declined_fields": [], "final_summary": "…"
}
```

Every field is documented in [docs/CASE_STATE_SCHEMA.md](docs/CASE_STATE_SCHEMA.md).
Integration instructions and three full examples for the Part 2 developer:
[docs/PART2_HANDOFF.md](docs/PART2_HANDOFF.md).

## Documentation index

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | components, data flow, design decisions, what is Part 1 vs Part 2 |
| [docs/CASE_STATE_SCHEMA.md](docs/CASE_STATE_SCHEMA.md) | every field of the output contract |
| [docs/API.md](docs/API.md) | endpoints with example requests and responses |
| [docs/PROMPTS.md](docs/PROMPTS.md) | the four prompts and the rules they enforce |
| [docs/SETUP.md](docs/SETUP.md) | step-by-step setup, environment variables, troubleshooting |
| [docs/EVALUATION.md](docs/EVALUATION.md) | metrics, dataset, how to run and read reports |
| [docs/PART2_HANDOFF.md](docs/PART2_HANDOFF.md) | contract and examples for the legal-analysis developer |
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | beginner explanations: venv, pip, .env, REST, FastAPI, Pydantic, LLM, JSON, Git… |
| [docs/GITHUB.md](docs/GITHUB.md) | pushing this repository to GitHub, step by step |

## Limitations (honest list)

- English is the primary language; Hindi/Hinglish input works through the LLM but question wording
  is English unless the model chooses otherwise. The internal CaseState is language-independent.
- No authentication: **do not expose this server publicly with real personal data.**
- Contradiction detection catches direct value conflicts reliably; subtle timeline logic depends on
  the optional LLM pass.
- Evidence is metadata only (type, description, whether the user has it); no file upload/analysis.
- Quality of extraction depends on the chosen model; Groq's free `openai/gpt-oss-120b` performs well, small
  local models may miss facts (never invent them, but miss them).

## Safety / legal disclaimer

The assistant records allegations as stated by the user, using neutral wording ("the person
allegedly…"). It does not decide whether an offence occurred, which law applies, or who is
responsible. Legal classification is the responsibility of Part 2 and, ultimately, of qualified
humans. Generated content must be reviewed before any official submission.
