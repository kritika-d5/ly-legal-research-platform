"""
DemoProvider - an offline "LLM" that replays the synthetic scenarios.

Set LLM_PROVIDER=demo and the chatbot works end-to-end with NO API key:
* for extraction prompts it returns the reference extraction stored next to a
  matching user message in data/sample_cases/scenarios.json;
* for question-wording prompts it returns the deterministic template;
* for summary prompts it returns the deterministic draft.

Great for presentations and for developing the UI without spending tokens.
For any message that is not in the dataset it returns an empty extraction.
"""
from __future__ import annotations

import json
import os
from typing import Optional

from app.extraction.prompts import EXTRACTION_SYSTEM_PROMPT
from app.llm.providers import MockProvider
from app.utils.text import normalize

DEFAULT_DATASET = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                               "data", "sample_cases", "scenarios.json")


def load_scenarios(path: str = DEFAULT_DATASET) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["scenarios"]


def latest_user_message(prompt: str) -> str:
    marker = "=== USER'S LATEST MESSAGE (extract from THIS) ==="
    if marker not in prompt:
        return ""
    return prompt.split(marker)[1].split("=== OUTPUT FORMAT ===")[0].strip()


class DemoProvider(MockProvider):
    name = "demo"
    model = "scripted-scenarios"

    def __init__(self, dataset_path: str = DEFAULT_DATASET, scenario_id: Optional[str] = None):
        super().__init__(responder=None)
        scenarios = load_scenarios(dataset_path)
        if scenario_id:
            scenarios = [s for s in scenarios if s["id"] == scenario_id]
        self.table: dict[str, dict] = {}
        for sc in scenarios:
            for turn in sc["turns"]:
                self.table.setdefault(normalize(turn["user"]), turn.get("extraction", {}))

    def lookup(self, message: str) -> dict:
        key = normalize(message)
        if key in self.table:
            return self.table[key]
        for k, v in self.table.items():          # tolerate small differences (prefix match)
            if k.startswith(key[:40]) or key.startswith(k[:40]):
                return v
        return {}

    async def generate_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False) -> str:
        self.calls.append({"system": system_prompt[:40], "json_mode": json_mode})
        if system_prompt == EXTRACTION_SYSTEM_PROMPT:
            return json.dumps(self.lookup(latest_user_message(user_prompt)))
        if "=== DEFAULT TEMPLATE QUESTION" in user_prompt:
            template = user_prompt.split("=== DEFAULT TEMPLATE QUESTION (keep the same meaning) ===")[1].split("===")[0].strip()
            return json.dumps({"question": template})
        if "=== DRAFT SUMMARY ===" in user_prompt:
            draft = user_prompt.split("=== DRAFT SUMMARY ===")[1].split("Return the JSON now.")[0].strip()
            return json.dumps({"summary": draft})
        return json.dumps({"contradictions": []})
