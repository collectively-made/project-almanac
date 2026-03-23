from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class AlmanacSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ALMANAC_")

    # Paths (Docker volume mounts)
    config_dir: Path = Path("/app/config")
    models_dir: Path = Path("/app/models")
    content_dir: Path = Path("/app/content")
    builtin_dir: Path = Path("/app/builtin")

    # Server
    host: str = "0.0.0.0"
    port: int = 8080

    # LLM
    llm_threads: Optional[int] = None  # None = auto-detect
    llm_context_window: Optional[int] = None  # None = auto from RAM

    # RAG
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    retrieval_top_k: int = 10
    rrf_k: int = 60
    min_retrieval_score: float = 0.3  # Safety floor

    # Safety
    max_message_length: int = 2048

    # CORS — restrict to same-origin by default
    cors_origins: str = ""  # Comma-separated origins, empty = same-origin only

    # Auto-setup: download and load a model on first boot
    auto_setup: bool = True


settings = AlmanacSettings()
