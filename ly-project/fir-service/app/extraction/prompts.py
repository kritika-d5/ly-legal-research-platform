"""
Prompts for the fact-extraction step.

WHAT IS A PROMPT?
-----------------
The text we send to the language model. A "system prompt" sets the rules and
role; the "user prompt" carries the actual input. We keep prompts in one file so
they can be reviewed, versioned and evaluated separately from code.

This prompt is deliberately strict: the model's job is to TRANSCRIBE facts into
a structure, never to reason about law or fill gaps.
"""
from __future__ import annotations

import json

from app.extraction.schemas import ExtractedFacts

EXTRACTION_SYSTEM_PROMPT = """You are a careful information-extraction engine for an incident intake assistant used in India.
Your ONLY job is to convert what the user wrote in their LATEST message into a structured JSON object.

ABSOLUTE RULES
1. Extract ONLY information that is actually present in the user's latest message (you may use the earlier conversation only to resolve references such as "he", "there", "the phone").
2. NEVER invent names, dates, times, places, injuries, witnesses, evidence, motives, intentions or relationships. If something is not stated, output null or an empty list.
3. Preserve uncertainty. "at night" -> time_description="night", time_hhmm=null. "recently" -> date_description="recently", date_iso=null. NEVER convert a vague word into a specific value.
4. Do NOT compute relative dates. For "yesterday", "last Thursday", "two days ago", put the phrase in date_description and leave date_iso null. Fill date_iso ONLY when the user states a calendar date (e.g. "8 September 2026" -> "2026-09-08"; if the year is missing, leave date_iso null and keep the words in date_description).
5. Fill time_hhmm ONLY for a clock time the user actually said ("8 pm" -> "20:00", "around 8 pm" -> time_hhmm="20:00" AND add "incident.time" to uncertain_fields).
6. Make NO legal conclusions. Do not mention IPC/BNS sections, offences, crimes or guilt. Describe acts factually using these act types only:
   physical_assault, threat, verbal_abuse, harassment, taking_property, property_damage, entering_premises, cheating_or_fraud, stalking_or_following, online_or_message_based, other.
7. Use neutral wording in descriptions: "allegedly", "the user states that". Never call anyone a criminal or offender.
8. If the user says they do not know something ("I don't know who he was", "I don't remember the time"), add the dotted field name to unknown_fields (e.g. "accused.name", "incident.time") and set identity_status="unknown" for an unidentified person.
9. If the user refuses to share something ("I don't want to give my address"), add the field to declined_fields (e.g. "complainant.address").
10. If the user corrects earlier information ("actually it was Thursday, not Wednesday", "sorry, it was 7 PM"), add an entry to corrections with field, old_value, new_value and quote, AND also put the new value in the normal place.
11. If the user explicitly denies something ("I was not injured", "nobody else was there", "no weapon"), set the corresponding flag to false (injury_occurred=false, witnesses_present=false, weapon_involved=false) and add a short note to denials.
12. If a pronoun or reference could refer to more than one person, do NOT guess: leave the field null and describe the ambiguity in ambiguous_references. If the reference is clear from context (only one person has been mentioned), you may resolve it but list the field in inferred_fields.
13. Any value you inferred rather than read verbatim goes in inferred_fields (dotted path). Any ambiguous value goes in uncertain_fields.
14. The user may write in English, Hindi, Hinglish or another Indian language. Understand it, but write all extracted values in English (keep proper names as given).
15. Set user_intent: "confirm" if the message mainly agrees with a summary ("yes that's correct"), "correct" if it mainly fixes something, "ask_question" if the user is asking you something, otherwise "provide_information".
16. When the user is the person harmed, set complainant_is_victim=true. If they are reporting on behalf of someone else, set it to false and fill victim.
17. Output ONLY one JSON object. No markdown, no commentary.

DOTTED FIELD NAMES you may use in inferred_fields / uncertain_fields / unknown_fields / declined_fields / corrections.field:
complainant.name, complainant.age, complainant.gender, complainant.address, complainant.contact,
victim.name, victim.age, victim.gender, complainant_is_victim,
accused.name, accused.alias, accused.description, accused.relationship_to_complainant, accused.address_or_whereabouts, accused.identity,
incident.date, incident.time, incident.location, incident.location_details, incident.description,
flags.injury_occurred, flags.weapon_involved, flags.property_involved, flags.threat_involved, flags.witnesses_present, flags.evidence_available,
injury.type, injury.body_part, injury.treatment_received, injury.hospital_or_doctor, injury.medical_report_available,
weapon.object, property.item, property.approximate_value, property.recovered, property.force_or_threat_used,
witness.name, witness.contact, evidence.description, evidence.in_possession.
"""

EXAMPLE_EXTRACTION = {
    "complainant": {"name": None, "age": None, "gender": None, "address": None, "contact": None,
                    "relationship_to_other_party": None, "other_details": None},
    "complainant_is_victim": True,
    "victim": {"name": None, "age": None, "gender": None, "address": None, "contact": None,
               "relationship_to_other_party": None, "other_details": None},
    "accused": [{"name": "Rahul", "alias": None, "description": None, "relationship_to_complainant": None,
                 "address_or_whereabouts": None, "identity_status": "known",
                 "alleged_actions": ["pushed the user", "took the user's phone"]}],
    "incident": {"date_iso": None, "date_description": "yesterday", "time_hhmm": None, "time_description": "evening",
                 "location": "near the railway station", "location_details": None,
                 "description": "The user states that Rahul stopped them near the station, an argument followed, and Rahul allegedly pushed them and took their phone.",
                 "ongoing_or_repeated": None},
    "acts": [{"type": "physical_assault", "description": "pushed the user", "by": "Rahul", "against": "complainant"},
             {"type": "taking_property", "description": "took the user's phone", "by": "Rahul", "against": "complainant"}],
    "injuries": [],
    "weapons": [],
    "property": [{"item": "mobile phone", "description": None, "approximate_value": None, "owner": "complainant",
                  "what_happened": "taken", "recovered": None, "force_or_threat_used": None}],
    "witnesses": [{"name": "Neha", "relationship": "friend", "contact": None, "what_witnessed": "saw the incident"}],
    "evidence": [],
    "timeline": [{"time_description": "yesterday evening", "description": "User was walking home from college and was stopped by Rahul near the station"},
                 {"time_description": None, "description": "Argument between user and Rahul"},
                 {"time_description": None, "description": "Rahul allegedly pushed the user and took the phone"}],
    "flags": {"injury_occurred": None, "weapon_involved": None, "property_involved": True, "threat_involved": None,
              "witnesses_present": True, "evidence_available": None, "police_informed_earlier": None},
    "inferred_fields": [],
    "uncertain_fields": [],
    "unknown_fields": [],
    "declined_fields": [],
    "corrections": [],
    "denials": [],
    "ambiguous_references": [],
    "user_intent": "provide_information",
    "detected_language": "en",
    "notes": None,
}


def build_extraction_user_prompt(
    user_message: str,
    conversation_history: list[dict],
    case_context_summary: str,
    last_question: str | None,
) -> str:
    """
    Assemble the user-side prompt.

    * conversation_history: last few turns, so pronouns can be resolved.
    * case_context_summary: compact text view of what is already in the CaseState,
      so the model knows which people already exist (avoids duplicating "Rahul").
    * last_question: the question the assistant just asked, so short answers like
      "around 8" or "no" can be interpreted correctly.
    """
    history_lines = []
    for m in conversation_history[-8:]:
        role = "ASSISTANT" if m.get("role") == "assistant" else "USER"
        history_lines.append(f"{role}: {m.get('content','')}")
    history_text = "\n".join(history_lines) if history_lines else "(none)"

    schema_json = json.dumps(ExtractedFacts.model_json_schema(), indent=None)
    example_json = json.dumps(EXAMPLE_EXTRACTION, indent=None)

    return f"""=== EARLIER CONVERSATION (for reference resolution only) ===
{history_text}

=== FACTS ALREADY RECORDED (do not re-extract unless the user repeats/corrects them; reuse the same names for existing people) ===
{case_context_summary or "(nothing yet)"}

=== QUESTION THE ASSISTANT JUST ASKED ===
{last_question or "(none - this is the user's opening description)"}

=== USER'S LATEST MESSAGE (extract from THIS) ===
{user_message}

=== OUTPUT FORMAT ===
Return one JSON object matching this JSON schema:
{schema_json}

Example of a well-formed answer for a different message ("Yesterday evening I was walking home from college when Rahul stopped me near the station. We argued and he pushed me and took my phone. My friend Neha saw it."):
{example_json}

Now produce the JSON for the user's latest message. Remember: null for anything not stated; never guess."""
