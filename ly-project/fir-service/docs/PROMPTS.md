# Prompts

Four specialised prompts, each with one job. All ask for **JSON only** and every answer is validated
against a Pydantic model (one corrective retry, then a safe failure). No single "do everything" prompt.

| # | Purpose | System prompt | Output model | Used by |
|---|---|---|---|---|
| 1 | Fact extraction | `EXTRACTION_SYSTEM_PROMPT` in `app/extraction/prompts.py` | `ExtractedFacts` | `FactExtractor` (every turn) |
| 2 | Question wording | `QUESTION_SYSTEM_PROMPT` in `app/conversation/prompts.py` | `QuestionOut` | `QuestionEngine` (optional, `LLM_QUESTION_WORDING`) |
| 3 | Contradiction analysis | `CONTRADICTION_SYSTEM_PROMPT` in `app/validation/contradictions.py` | `LLMContradictionReport` | `ContradictionDetector.llm_check` (optional, `LLM_CONTRADICTION_CHECK`) |
| 4 | Summary polishing | `SUMMARY_SYSTEM_PROMPT` in `app/conversation/prompts.py` | `SummaryOut` | `polish_summary` (optional) |

## 1. Fact extraction

**Inputs (user prompt):** last ≤8 turns (for pronoun resolution only), a compact text view of facts
already recorded (so the model reuses existing names and does not duplicate people), the question the
assistant just asked (so "around 8" is understood), the new message, the JSON schema, and one worked
example for a *different* message.

**Rules it enforces (requirement §29):**
- extract only what is in the latest message; `null`/empty otherwise — *never invent*;
- preserve uncertainty: vague words stay words (`time_description="night"`, `time_hhmm=null`);
- **do not compute relative dates** — `"yesterday"` goes in `date_description`; Python resolves it;
- fill `time_hhmm` only for a stated clock time; mark "around 8" as `uncertain_fields`;
- no legal conclusions, no IPC/BNS, neutral wording ("allegedly");
- factual act categories only (`physical_assault`, `taking_property`, …);
- "I don't know X" → `unknown_fields`; refusals → `declined_fields`; denials → flags `false` + `denials`;
- corrections → `corrections[{field, old_value, new_value, quote}]`;
- ambiguous pronouns → do not guess, list in `ambiguous_references`; safe inferences → `inferred_fields`;
- Hindi/Hinglish understood, values written in English;
- `user_intent` ∈ provide_information / confirm / correct / ask_question / other.

**Why one example only, and for a different sentence:** it anchors the shape without teaching the
model to copy content.

## 2. Question wording

**Inputs:** recorded facts, recent turns, the missing field, why it matters, the deterministic template,
and recently asked questions.

**Rules (requirement §30):** exactly one question; do not ask what is already recorded; do not suggest
or assume facts, names or intent ("Did Rahul intentionally attack you with a weapon?" is forbidden;
"Was any object used during the incident?" is right); no legal jargon; neutral; ≤30 words; respect
unknown/declined; mirror the user's language style.

**Guard rails in code:** the answer must be 8–260 characters with at most one `?`, otherwise the
template is used. The *field* being asked is always chosen by rules, never by the model, so the model
cannot steer the interview.

## 3. Contradiction analysis (optional pass)

**Inputs:** recorded facts, the timeline, recent turns, latest message.
**Rules:** report only clear inconsistencies in the user's own statements (times/places/identity/injury
vs treatment/relationship/impossible order); never report missing information or compatible
refinements ("evening" + "7:30 PM" is fine); neutral one-sentence explanations. Runs only when there
are ≥2 acts/timeline events and the deterministic merge produced no conflict this turn (saves calls).

## 4. Summary polishing (optional)

**Input:** the deterministic draft (`build_summary`) which is guaranteed to contain only CaseState
facts. **Rules:** include every fact, add nothing, keep "not provided"/"not known" markers, neutral
wording, fixed section order, end with the exact review question. If the LLM output is too short or
drops the review question, the draft is used.

## Cost control

Per turn: 1 extraction call (mandatory) + 1 question-wording call (optional) + at most 1 contradiction
call (conditional). Completeness, merging, date maths, repetition control and the summary draft are
all deterministic. Set `LLM_QUESTION_WORDING=false` and `LLM_CONTRADICTION_CHECK=false` for a
one-call-per-turn configuration. Temperature is 0 for reproducibility.

## Changing a prompt safely

1. Edit the constant.
2. Run `pytest` (offline tests do not depend on prompt text except the demo provider's markers:
   `=== USER'S LATEST MESSAGE (extract from THIS) ===`, `=== DEFAULT TEMPLATE QUESTION`, `=== DRAFT SUMMARY ===` — keep those).
3. Run `python -m evaluation.run_eval --live` and compare `evaluation/reports/report_live.md` before/after.
