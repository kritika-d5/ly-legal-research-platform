"""
LLM abstraction layer - the ONLY place the rest of the app talks to a model.

Everything else calls:

    llm.generate_structured(system_prompt, user_prompt, schema=SomePydanticModel)

and receives a validated Pydantic object. Which vendor answers (Groq, Gemini,
Ollama, a mock) is decided by configuration, not by code.

STRUCTURED OUTPUT PIPELINE
--------------------------
    call model -> extract JSON -> Pydantic validate
        valid?   -> return object
        invalid? -> retry ONCE with the validation error appended
        still invalid? -> raise StructuredOutputError (never an infinite loop)
"""
from __future__ import annotations

import abc
import logging
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

from app.llm.json_utils import extract_json_object

log = logging.getLogger(__name__)

TModel = TypeVar("TModel", bound=BaseModel)


class LLMError(Exception):
    """Base class for all LLM-related failures."""


class LLMUnavailableError(LLMError):
    """Network down, rate limited, timeout, bad key - anything where the model could not answer."""


class StructuredOutputError(LLMError):
    """The model answered but never produced valid structured output."""


class LLMProvider(abc.ABC):
    """Interface every provider must implement."""

    name: str = "base"

    @abc.abstractmethod
    async def generate_text(self, system_prompt: str, user_prompt: str, *, json_mode: bool = False) -> str:
        """Return raw text from the model. `json_mode=True` asks the vendor to emit JSON only."""

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        schema: Type[TModel],
        *,
        max_retries: int = 1,
    ) -> TModel:
        """Text -> JSON -> validated Pydantic object, with one corrective retry."""
        last_error = ""
        prompt = user_prompt
        for attempt in range(max_retries + 1):
            raw = await self.generate_text(system_prompt, prompt, json_mode=True)
            try:
                data = extract_json_object(raw)
                return schema.model_validate(data)
            except (ValueError, ValidationError) as exc:
                last_error = str(exc)[:1500]
                log.warning(
                    "structured output invalid provider=%s schema=%s attempt=%d error=%s",
                    self.name, schema.__name__, attempt + 1, type(exc).__name__,
                )
                prompt = (
                    f"{user_prompt}\n\n"
                    "IMPORTANT: Your previous answer was not valid for the required JSON schema. "
                    f"Validation error:\n{last_error}\n"
                    "Return ONLY a single valid JSON object that matches the schema. No prose, no markdown."
                )
        raise StructuredOutputError(
            f"{self.name} did not return valid {schema.__name__} JSON after {max_retries + 1} attempts: {last_error}"
        )
