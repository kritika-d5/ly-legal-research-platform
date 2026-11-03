# Evaluation

"The chatbot works" is not a result. This document defines measurable metrics, the synthetic dataset,
and how to run and read the evaluation.

## Dataset

`data/sample_cases/scenarios.json` — 19 synthetic, fictional scenarios (no real people):

| # | id | covers |
|---|---|---|
| 1 | assault_theft_station | physical assault + theft, known accused, witness, no injury, no evidence |
| 2 | assault_stick_injury | weapon, injury, hospital, medical report, evidence |
| 3 | threat_phone_calls | threats, repeated, audio evidence, uncertain time |
| 4 | theft_unknown_accused | unknown accused, description, ambiguous time, minor injury |
| 5 | property_damage_landlord | property damage, entering premises, explicit date |
| 6 | multiple_accused_group | three accused (one unknown), reporting on behalf of a brother |
| 7 | harassment_stalking | stalking, repeated, ambiguous date, time range |
| 8 | contradiction_time | 8 PM vs 7 PM without declared correction |
| 9 | contradiction_identity | named person, later "don't know who" |
| 10 | contradiction_injury | "not injured", later hospital treatment |
| 11 | contradiction_timeline | left at 7:30 vs incident at 8 (LLM pass) |
| 12 | user_refuses_information | declines name, address, contact |
| 13 | user_changes_answer | "Thursday, not Wednesday" |
| 14 | sparse_input_hallucination | almost no information — nothing may be invented |
| 15 | hinglish_input | Hinglish opening |
| 16 | known_accused_no_witness_no_evidence | cheating, no witness/evidence |
| 17 | online_message_threats | partially identified (alias), message evidence |
| 18 | ambiguous_date_recently | "recently", unknown time |
| 19 | repeated_information | same facts repeated — no duplication |

Each turn stores the user message and the **reference extraction** (what a correct LLM should return).
`expect` blocks hold assertions.

## Metrics

| Metric | Definition | Computed from |
|---|---|---|
| **Fact extraction accuracy** | share of expected facts (dotted paths, e.g. `accused[0].name.value = "Rahul"`) present in the final CaseState; string checks are case-insensitive substring | `expect.facts`, `list_lengths`, `declined`, `unknown` |
| **Hallucination rate** | share of "must stay empty" checks that were violated (fields expected `null`, lists expected empty) | `expect.must_be_null`, `expect.empty_lists` |
| **Question relevance** | share of turns with an `expect_question_in` set where the next question's field was in that set | per-turn `expect_question_in` |
| **Redundancy rate** | share of questions asked about a field that was already resolved before that turn, plus violations of `max_times_asked` | computed from completeness rules before each turn |
| **Contradiction detection** | inserted contradictions flagged (by field), no false positives where `contradiction_fields: []`, and resolution recorded | `expect.contradiction_fields`, `contradictions_resolved` |
| **Completeness detection** | intentionally missing fields reported in `missing` after a given turn | `expect.missing_after_turn` |
| **Scenario completion** | scenarios reaching the expected final status (`complete` / `in_progress`) | `expect.final_status` |

## Two modes

```bash
python -m evaluation.run_eval            # OFFLINE
python -m evaluation.run_eval --live     # LIVE (uses the provider in .env)
```

| | Offline | Live |
|---|---|---|
| Extraction | reference extraction replayed by `DemoProvider` | the real LLM |
| What it measures | merge, date resolution, contradiction rules, completeness rules, question selection, review/confirm flow | all of that **plus** the model's extraction quality and hallucination behaviour |
| Cost | none | ~2–3 calls per turn (≈130 turns total) |

Offline results are a *regression test* for the deterministic pipeline (should stay at 100 %/0 %).
Live results are the numbers to report for the model you chose.

## Reports

Written to `evaluation/reports/report_offline.md` / `report_live.md` (git-ignored). Sections: metrics
table, per-scenario table (status, completion %, questions asked, turns, contradictions, LLM errors),
and the list of every failed check with actual vs expected values.

Current offline baseline (deterministic pipeline):

| metric | result |
|---|---|
| Fact extraction accuracy | 118/118 = 100 % |
| Hallucination rate | 0/35 = 0 % |
| Question relevance | 11/11 = 100 % |
| Redundancy rate | 0/90 = 0 % |
| Contradiction detection | 6/6 = 100 % |
| Completeness detection | 5/5 = 100 % |
| Scenario completion | 19/19 = 100 % |

Run `--live` with your provider and paste the table into your project report alongside this baseline;
the difference between the two isolates the LLM's contribution.

## Adding a scenario

1. Append an object to `scenarios` with `id`, `title`, `tags`, `turns[]` (`user`, `extraction`,
   optional `expect_question_in`) and `expect`.
2. Expected date values may use `@today`, `@yesterday`, `@2daysago`, `@lastthursday` (resolved against
   the case creation date).
3. `python demo.py --scenario <id>` to watch it; `python -m evaluation.run_eval --ids <id>` to score it.

## Known limits of this evaluation

- Question relevance is only scored on turns with an `expect_question_in` set (11 checks), because
  several orderings can be equally sensible.
- The offline mode cannot detect LLM-only contradictions (timeline logic); `llm_only_contradiction_fields`
  is scored only in live mode with `LLM_CONTRADICTION_CHECK=true`.
- Scenarios are synthetic and English/Hinglish only.
