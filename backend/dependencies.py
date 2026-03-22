from __future__ import annotations

from functools import lru_cache

from backend.config import settings
from backend.db import Database
from backend.llm.manager import LLMManager
from backend.rag.fulltext import FullTextSearch
from backend.rag.retriever import Retriever
from backend.rag.vectorstore import VectorStore


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


@lru_cache
def get_vectorstore() -> VectorStore:
    return VectorStore(settings.config_dir / "almanac.db")


@lru_cache
def get_fulltext() -> FullTextSearch:
    return FullTextSearch(settings.config_dir / "almanac.db")


@lru_cache
def get_retriever() -> Retriever:
    return Retriever(
        vectorstore=get_vectorstore(),
        fulltext=get_fulltext(),
        embedding_model_name=settings.embedding_model,
    )
