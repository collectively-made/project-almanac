from __future__ import annotations

from functools import lru_cache

from backend.config import settings
from backend.db import Database
from backend.llm.manager import LLMManager


@lru_cache
def get_database() -> Database:
    return Database(settings.config_dir / "almanac.db")


@lru_cache
def get_llm_manager() -> LLMManager:
    return LLMManager(
        models_dir=settings.models_dir,
        threads=settings.llm_threads,
        context_window=settings.llm_context_window,
    )
