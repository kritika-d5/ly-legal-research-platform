# Concepts Explained (for learning while building)

Short, practical explanations of every concept used in this project, each tied to where it appears here.

## Python tooling

**Virtual environment (`.venv/`)** — a private copy of Python's package folder for one project.
Without it, two projects needing different versions of the same library would fight. Create once
(`python3 -m venv .venv`), activate in every new terminal (`source .venv/bin/activate`).

**pip / `requirements.txt`** — `pip install X` downloads a package; `requirements.txt` pins exact
versions (`fastapi==0.115.6`) so a teammate installs the identical set with `pip install -r requirements.txt`.

**`python -m module`** — runs a module as a script using the active environment's Python
(`python -m pytest`, `python -m evaluation.run_eval`).

## Configuration

**Environment variable** — a named value the operating system hands to a program
(`LLM_API_KEY=gsk_…`). Programs read them instead of hard-coding secrets.

**`.env` / `.env.example`** — `.env` lists your variables; the app loads it at startup
(`app/config.py`, via `pydantic-settings`). `.env.example` is the committed template with empty values.
`.gitignore` excludes `.env` so your key never reaches GitHub.

**API key** — a secret string that identifies your account to a service. Anyone holding it can spend
your quota. Treat it like a password: never paste it into code, chat, or a commit.

## Web / API

**Frontend vs backend** — the frontend (`frontend/`) is what runs in the browser; the backend
(`app/`) runs on the server and holds the logic and data. They talk over HTTP.

**HTTP GET vs POST** — GET reads ("give me case 123"), POST creates or acts ("here is a new message").
GET requests have no body; POST requests carry JSON.

**REST API / endpoint** — a set of URL + method pairs, each doing one thing (`POST /cases`,
`GET /cases/{id}/state`). Documented in `docs/API.md`.

**JSON** — the text format for structured data (`{"name": "Rahul", "age": 20}`). Both our API and
the LLM output use it.

**FastAPI** — the Python web framework we use. You write a function, decorate it with
`@router.post("/cases")`, and FastAPI handles routing, validation, JSON conversion and generates
interactive docs at `/docs`.

**uvicorn** — the server program that runs a FastAPI app (`uvicorn app.main:app --reload`).

**CORS** — a browser safety rule: a page from origin A may call an API on origin B only if B allows it.
Our UI is served from the same origin so it just works; `CORS_ORIGINS` exists for a future React app on
`localhost:3000` (`app/main.py`).

**Status codes** — `200` OK, `201` created, `404` not found, `422` your input failed validation,
`503` a dependency (the LLM) is unavailable, `500` our bug.

## Data modelling

**Pydantic model / schema** — a Python class describing the shape and types of data. Pydantic checks
incoming data against it and raises a readable error on mismatch. `CaseState`, `ExtractedFacts`, every
request/response body — all Pydantic.

**Validation** — the act of checking data against a schema. We validate user input (`MessageRequest`),
LLM output (`ExtractedFacts`), and stored state (`CaseState`).

**Serialization** — converting an object to text (JSON) for storage or transfer, and back
(`state.to_json()`, `CaseState.from_json()`).

**Enum** — a fixed list of allowed values (`FactStatus.EXPLICIT`, `ActType.THREAT`). Prevents typos and
documents the vocabulary.

**Provenance** — *where a piece of information came from*. Our `Fact.status` records it, so the
system never confuses "the user said it" with "we guessed it".

## State and storage

**State management** — keeping the evolving truth of a conversation somewhere durable. Ours is the
`CaseState` object, saved after every turn.

**In-memory vs database** — a Python variable disappears when the server stops; a database file
survives. We use **SQLite** (one file, no installation) through a `Repository` class so PostgreSQL can
replace it later. Tables: `cases`, `messages`, `case_states` (`app/storage/repository.py`).

## Large language models

**LLM** — a model that reads text and produces text. We use it for two language tasks only:
understanding the user's story and phrasing questions kindly.

**Prompt** — the instructions + input we send. A *system prompt* sets the rules; the *user prompt*
carries the data. Ours live in `app/extraction/prompts.py` and `app/conversation/prompts.py`.

**Structured output** — asking the model for JSON matching a schema instead of free prose, then
validating it with Pydantic. If invalid, we retry once with the validation error, then fail safely
(`app/llm/base.py`).

**Temperature** — randomness knob. `0` = same answer every time (what we want for extraction).

**Tokens** — the units models read and bill by (roughly ¾ of a word). Shorter prompts and fewer calls
per turn keep the free tier happy; see cost notes in `docs/PROMPTS.md`.

**Hallucination** — the model stating something that was never in the input. Our defences: strict
prompt rules, `null` defaults, code-side date resolution, and the evaluation's hallucination metric.

**Provider abstraction** — one interface (`LLMProvider.generate_structured`) with several
implementations (Groq, Gemini, Ollama, mock, demo), chosen by configuration, so the rest of the code
never mentions a vendor.

**Async / `await`** — Python's way of not blocking while waiting for the network. FastAPI runs our
`async def` endpoints concurrently; the LLM calls use `httpx.AsyncClient`. In tests, `pytest-asyncio`
lets test functions be `async` too.

## Quality

**Unit test** — checks one small piece in isolation (`tests/test_merger.py`).
**Integration test** — checks pieces working together (`tests/test_manager_flow.py`, `tests/test_api.py`).
**Fixture** — reusable setup for tests (`tests/conftest.py`).
**Mock** — a fake stand-in for something slow or external; `MockProvider` plays the LLM offline.
**Evaluation** — measuring behaviour with numbers on a dataset (`evaluation/run_eval.py`).

**Logging** — structured messages about what the program did (timings, errors, ids), without
sensitive content (`app/utils/logging.py`).

## Git and GitHub (details in `docs/GITHUB.md`)

**Git** — version control on your machine: snapshots ("commits") of the project over time.
**GitHub** — a website hosting Git repositories so others can clone and collaborate.
**Repository** — the project folder tracked by Git. **Commit** — a saved snapshot with a message.
**Branch** — a parallel line of commits (`main` is the default). **Remote** — the copy on GitHub
(`origin`). **Push/pull** — upload/download commits. **Pull request** — a proposal to merge a branch,
reviewed by teammates before it lands.
