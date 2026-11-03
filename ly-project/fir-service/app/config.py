"""
Application configuration.

WHAT THIS FILE DOES
-------------------
Reads settings from environment variables (and from a `.env` file if one
exists) and exposes them as one typed `Settings` object.

WHY
---
We never hard-code API keys or model names in source code. Anyone who clones
the repo creates their own `.env` (copied from `.env.example`) and the code
picks the values up automatically.

HOW
---
`pydantic-settings` looks at every attribute of the `Settings` class, finds an
environment variable with the same name (case-insensitive), converts it to the
declared type, and raises a clear error if something required is missing.

USAGE
-----
    from app.config import get_settings
    settings = get_settings()
    print(settings.llm_provider)
"""
from __future__ import annotations

from functools import lru_cache
from typing import List, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["groq", "gemini", "ollama", "openai_compatible", "mock", "demo"]

# Default base URLs for the providers that speak the OpenAI chat format.
DEFAULT_BASE_URLS = {
    "groq": "https://api.groq.com/openai/v1",
    "ollama": "http://localhost:11434/v1",
    "openai_compatible": "https://openrouter.ai/api/v1",
}

DEFAULT_MODELS = {
    "groq": "openai/gpt-oss-120b",
    "gemini": "gemini-2.0-flash",
    "ollama": "llama3.1:8b",
    "openai_compatible": "meta-llama/llama-3.3-70b-instruct:free",
    "mock": "mock",
    "demo": "scripted-scenarios",
}


class Settings(BaseSettings):
    """All runtime configuration for the application."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- LLM ---
    llm_provider: ProviderName = "groq"
    llm_api_key: str = ""
    llm_model: str = ""
    llm_base_url: str = ""
    llm_temperature: float = 0.0
    llm_timeout_seconds: float = 60.0
    llm_question_wording: bool = True
    llm_contradiction_check: bool = True

    # --- Storage ---
    database_url: str = "sqlite:///./data/fir_chatbot.db"

    # --- App ---
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:8000,http://127.0.0.1:8000"
    app_name: str = "FIR Intake Assistant (Academic Prototype)"

    # --- Access control ---
    # Shared with the LY Express server, which sends it on every proxied request
    # together with the logged-in user's id (X-Proxy-Secret / X-User-Id).
    # Set  -> "proxied mode": requests without the right secret are refused and
    #         every case is visible only to the user who created it.
    # Empty -> "standalone mode" (the bundled UI at :8000 and the tests): no
    #         login, every case visible, exactly as in Part 1.
    proxy_shared_secret: str = ""

    # Conversation safety limits
    max_follow_up_questions: int = 25
    max_repeat_per_field: int = 2

    @field_validator("llm_temperature")
    @classmethod
    def _clamp_temperature(cls, v: float) -> float:
        return max(0.0, min(2.0, v))

    @property
    def resolved_model(self) -> str:
        return self.llm_model or DEFAULT_MODELS.get(self.llm_provider, "")

    @property
    def resolved_base_url(self) -> str:
        return (self.llm_base_url or DEFAULT_BASE_URLS.get(self.llm_provider, "")).rstrip("/")

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlite_path(self) -> str:
        """Turn `sqlite:///./data/x.db` into `./data/x.db`."""
        prefix = "sqlite:///"
        if self.database_url.startswith(prefix):
            return self.database_url[len(prefix):]
        raise ValueError(
            "Only SQLite is implemented in this prototype. "
            "See docs/ARCHITECTURE.md for how to add PostgreSQL."
        )

    def validate_for_llm(self) -> None:
        """Raise a friendly error if the chosen provider lacks what it needs."""
        needs_key = self.llm_provider in {"groq", "gemini", "openai_compatible"}
        if needs_key and not self.llm_api_key:
            raise RuntimeError(
                f"LLM_PROVIDER is '{self.llm_provider}' but LLM_API_KEY is empty. "
                "Copy .env.example to .env and paste your free API key. "
                "Groq: https://console.groq.com/keys  |  Gemini: https://aistudio.google.com/apikey"
            )


@lru_cache
def get_settings() -> Settings:
    """Cached singleton so the .env file is read only once."""
    return Settings()
