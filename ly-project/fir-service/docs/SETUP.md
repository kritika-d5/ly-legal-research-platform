# Setup Guide (beginner-friendly)

Everything below is run in a terminal opened **inside the project folder**
(`cd "/path/to/ly project"`). Commands are for macOS/Linux; Windows differences are noted.

## 0. Prerequisites

| Tool | Check | Install |
|---|---|---|
| Python 3.11+ | `python3 --version` | https://www.python.org/downloads/ |
| Git | `git --version` | https://git-scm.com/downloads |
| (optional) Ollama for a fully local model | `ollama --version` | https://ollama.com |

## 1. Virtual environment

A *virtual environment* is a private folder (`.venv/`) holding this project's Python packages so they
do not clash with other projects on your computer.

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows PowerShell:  .venv\Scripts\Activate.ps1
```
Your prompt now starts with `(.venv)`. Run `deactivate` to leave it. **Activate it every time you open
a new terminal for this project.**

## 2. Install dependencies

`pip` is Python's package installer; `requirements.txt` lists exact versions so everyone gets the same.

```bash
pip install --upgrade pip
pip install -r requirements.txt
```
Expected: a list of `Successfully installed ...`. If you see `command not found: pip`, the venv is not
activated.

## 3. Configuration (`.env`)

Programs read settings from *environment variables*. A `.env` file is a convenient list of them that
the app loads at startup. It is **ignored by git** (see `.gitignore`) so secrets never leave your machine.

```bash
cp .env.example .env         # Windows: copy .env.example .env
```
Open `.env` in any editor. The important lines:

```
LLM_PROVIDER=groq
LLM_API_KEY=paste_your_key_here
LLM_MODEL=openai/gpt-oss-120b
```

### Getting a free API key

**Groq (recommended: fast, generous free tier)**
1. Go to https://console.groq.com and sign up (Google/GitHub login works).
2. Left menu → *API Keys* → *Create API Key* → name it `fir-chatbot` → copy the key (starts with `gsk_`).
3. Paste it as `LLM_API_KEY=` in `.env`. Keep `LLM_PROVIDER=groq`.

**Google Gemini (also free)**
1. Go to https://aistudio.google.com/apikey → *Create API key*.
2. In `.env`: `LLM_PROVIDER=gemini`, `LLM_API_KEY=<key>`, `LLM_MODEL=gemini-2.0-flash`.

**Ollama (no key, runs on your Mac, slower, works offline)**
```bash
brew install ollama            # or download from ollama.com
ollama serve &                 # starts the local server (keep it running)
ollama pull llama3.1:8b        # downloads ~4.7 GB once
```
In `.env`: `LLM_PROVIDER=ollama`, `LLM_MODEL=llama3.1:8b`, `LLM_API_KEY=` (empty).

**Demo mode (zero setup)** — `LLM_PROVIDER=demo` replays the built-in synthetic scenarios: the chatbot
"understands" only the messages that appear in `data/sample_cases/scenarios.json` (great for a UI demo
or presentation without internet).

### All variables

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `groq` | `groq` / `gemini` / `ollama` / `openai_compatible` / `demo` / `mock` |
| `LLM_API_KEY` | empty | secret key for cloud providers |
| `LLM_MODEL` | provider default | model name |
| `LLM_BASE_URL` | provider default | override for OpenRouter / LM Studio etc. |
| `LLM_TEMPERATURE` | `0.0` | randomness; keep 0 for extraction |
| `LLM_TIMEOUT_SECONDS` | `60` | request timeout |
| `LLM_QUESTION_WORDING` | `true` | let the LLM phrase questions (false = templates, fewer calls) |
| `LLM_CONTRADICTION_CHECK` | `true` | extra LLM pass for timeline contradictions |
| `DATABASE_URL` | `sqlite:///./data/fir_chatbot.db` | where cases are stored |
| `LOG_LEVEL` | `INFO` | `DEBUG` for verbose logs |
| `CORS_ORIGINS` | localhost origins | allowed browser origins for a separately hosted frontend |

## 4. Run the backend and open the UI

```bash
uvicorn app.main:app --reload
```
`uvicorn` is the web server; `app.main:app` means "the `app` object in `app/main.py`"; `--reload`
restarts automatically when you edit code. Expected output ends with
`Uvicorn running on http://127.0.0.1:8000`.

Open http://localhost:8000 → the chat UI. Open http://localhost:8000/docs → auto-generated API docs
where you can click *Try it out* on every endpoint.

Stop the server with `Ctrl+C`.

## 5. Run the demo

```bash
python demo.py                 # offline scripted scenario
python demo.py --live          # same script but the REAL model does the extraction
python demo.py --interactive   # you type; needs a real provider
```

## 6. Run the tests

```bash
pytest
```
Expected: `52 passed, 5 skipped` (the 5 live tests skip without a key). With a key configured, run
`pytest tests/test_live_llm.py -v -s` to exercise the real model.

## 7. Run the evaluation

```bash
python -m evaluation.run_eval          # offline
python -m evaluation.run_eval --live   # real model; writes evaluation/reports/report_live.md
```

## 8. Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'fastapi'` | venv not active or deps not installed | `source .venv/bin/activate && pip install -r requirements.txt` |
| `LLM_PROVIDER is 'groq' but LLM_API_KEY is empty` | `.env` missing or key not pasted | create `.env` from `.env.example`, paste key, restart server |
| Chat reply starts with "The language model is temporarily unavailable" | timeout, rate limit (HTTP 429) or bad key | wait a minute, check the key, check internet; logs in the terminal show the exact reason |
| `authentication failed (HTTP 401)` | wrong/revoked key | create a new key |
| Groq `HTTP 400 ... model` | model name changed | check https://console.groq.com/docs/models and update `LLM_MODEL` |
| `Address already in use` | another server on port 8000 | `uvicorn app.main:app --port 8001` and open that port |
| UI loads but "Could not create case" | backend not running or different port | start uvicorn; if hosted separately set `API` in `frontend/app.js` |
| Ollama: `network error ... 11434` | Ollama server not running | `ollama serve` |
| `sqlite3.OperationalError: database is locked` | two servers using the same DB file | stop one; or set a different `DATABASE_URL` |
| Tests: `no live LLM configured` | expected without a key | not an error |

Debugging recipe: **read the error → find which layer raised it (provider / extraction / merge / API)
→ set `LOG_LEVEL=DEBUG` → reproduce with `python demo.py --live --verbose` → fix → re-run `pytest`.**

## 9. Replacing the UI with React/Next.js later

The UI uses only three calls: `POST /cases`, `POST /cases/{id}/messages`, `POST /cases/{id}/confirm`
(plus `GET /cases/{id}` to resume). A React app on `http://localhost:3000` works as-is because
`CORS_ORIGINS` already includes it; point its fetch base URL at `http://localhost:8000`.
