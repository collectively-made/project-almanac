from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.dependencies import get_llm_manager
from backend.llm.manager import LLMManager

router = APIRouter()


@router.get("/api/health")
async def health(llm: LLMManager = Depends(get_llm_manager)):
    """Health endpoint — always returns 200 if server is running.

    Decoupled from model state so NAS management UIs don't restart
    the container during model loading.
    """
    return {
        "status": "ok",
        "model_loaded": llm.is_loaded,
        "model_name": llm.model_name,
        "indexed_chunks": 0,  # Updated once RAG pipeline is wired
    }
