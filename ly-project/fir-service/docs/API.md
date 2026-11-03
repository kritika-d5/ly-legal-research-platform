# API Reference

Base URL (local): `http://localhost:8000`. Interactive docs (Swagger UI): `http://localhost:8000/docs`.
All bodies are JSON. No authentication (academic prototype — do not expose publicly with real data).

## POST `/cases` — start a case

Request (optional body):
```json
{ "language": "en" }
```
Response `201`:
```json
{
  "case_id": "case_21cf59e7a0",
  "assistant_message": "Hello. I can help you document the facts of an incident ... Please describe what happened, in your own words.",
  "status": "in_progress",
  "disclaimer": "Academic prototype. This assistant organises information you provide; it does not determine guilt ..."
}
```

## POST `/cases/{case_id}/messages` — one conversational turn

Request:
```json
{ "message": "Yesterday evening Rahul pushed me near the station and took my phone. My friend Neha saw it." }
```
Response `200` (abridged):
```json
{
  "case_id": "case_21cf59e7a0",
  "assistant_message": "How do you know Rahul? What is your relationship with them?",
  "next_action": "ask_question",
  "status": "in_progress",
  "completeness": {
    "complete": false,
    "completion_percentage": 63,
    "missing": [
      {"field": "accused.relationship_to_complainant", "priority": "medium", "reason": "the person is known to you",
       "suggested_question": "How do you know Rahul? What is your relationship with them?"},
      {"field": "flags.injury_occurred", "priority": "medium", "reason": "physical contact was described",
       "suggested_question": "Were you, or anyone else, physically hurt during this incident?"}
    ],
    "recommended_questions": ["How do you know Rahul? ...", "Were you, or anyone else, physically hurt ..."],
    "applicable_fields": 19, "resolved_fields": 12, "exhausted_fields": []
  },
  "open_contradictions": [],
  "changes": ["complainant_is_victim = True", "incident.date = 2026-09-08", "incident.time = evening", "accused added: Rahul", "..."],
  "progress": [
    {"label": "What happened", "status": "done", "detail": "2 act(s) recorded"},
    {"label": "Date", "status": "done", "detail": "2026-09-08"},
    {"label": "Time", "status": "done", "detail": "evening (approx.)"},
    {"label": "Injuries", "status": "missing", "detail": null}
  ],
  "case_state": { "...full CaseState, see CASE_STATE_SCHEMA.md..." },
  "warning": null
}
```

`next_action` values:

| value | meaning | what the client should do |
|---|---|---|
| `ask_question` | assistant asked a follow-up | show the message, wait for the user |
| `clarify_contradiction` | an inconsistency needs the user's answer | show it (UI highlights `open_contradictions`) |
| `review_summary` | the summary was produced; status is `awaiting_confirmation` | show Confirm / Correct buttons |
| `complete` | case confirmed | show download / new case |
| `error` | reserved | |

`warning` is set (and prefixed to `assistant_message`) when the LLM was unavailable or returned
malformed output; the message is saved and the user can retry.

Errors: `404` unknown case · `422` empty message (>8000 chars also rejected) · `503` LLM unavailable on
endpoints that cannot proceed without it · `500` unexpected.

## GET `/cases/{case_id}` — overview

Response: `case_id, status, created_at, updated_at, messages[], completeness, progress[], case_state`.
`messages[]` items: `{role: "user"|"assistant", content, turn, created_at}`.

## GET `/cases/{case_id}/state` — the Part 2 input

```json
{ "case_state": { "schema_version": "1.0", "case_id": "...", "status": "complete", "...": "..." } }
```

## GET `/cases/{case_id}/messages` — transcript only

## GET `/cases/{case_id}/completeness`

Same object as `completeness` above. Deterministic; safe to poll.

## GET `/cases/{case_id}/summary`

```json
{
  "case_id": "case_21cf59e7a0",
  "status": "awaiting_confirmation",
  "summary": "Please review the information I have collected so far.\n\nINCIDENT\n- What happened ...\n\nIs this information correct? You can confirm, correct something, or add more details.",
  "open_contradictions": [],
  "completeness": { "...": "..." }
}
```
Does not change the case status. The summary is generated from the CaseState (LLM only rephrases).

## POST `/cases/{case_id}/confirm`

Request:
```json
{ "confirmed": true }
```
or to reopen with a correction:
```json
{ "confirmed": false, "note": "Actually it was Thursday, not Wednesday." }
```
Response:
```json
{
  "case_id": "case_21cf59e7a0",
  "status": "complete",
  "user_confirmed": true,
  "assistant_message": "Thank you. I have recorded your confirmation. ...",
  "case_state": { "...": "..." }
}
```
If contradictions are still open, confirmation is refused and the message contains the clarification
question instead (`user_confirmed` stays `false`).

## GET `/cases?limit=50` — recent cases

```json
[ {"case_id": "case_...", "created_at": "...", "updated_at": "...", "status": "complete"} ]
```

## GET `/health`

```json
{ "status": "ok", "provider": "groq", "model": "openai/gpt-oss-120b" }
```

## curl walkthrough

```bash
CASE=$(curl -s -X POST localhost:8000/cases | python -c "import sys,json;print(json.load(sys.stdin)['case_id'])")
curl -s -X POST localhost:8000/cases/$CASE/messages -H 'Content-Type: application/json' \
     -d '{"message":"Yesterday evening Rahul pushed me near the station and took my phone. My friend Neha saw it."}' | python -m json.tool | head -40
curl -s localhost:8000/cases/$CASE/completeness | python -m json.tool
curl -s localhost:8000/cases/$CASE/summary | python -m json.tool
curl -s -X POST localhost:8000/cases/$CASE/confirm -H 'Content-Type: application/json' -d '{"confirmed":true}'
curl -s localhost:8000/cases/$CASE/state > case.json
```
