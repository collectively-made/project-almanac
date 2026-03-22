from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.dependencies import get_llm_manager, get_vectorstore
from backend.llm.manager import LLMManager
from backend.rag.vectorstore import VectorStore

router = APIRouter()


@router.get("/api/health")
async def health(
    llm: LLMManager = Depends(get_llm_manager),
    vectorstore: VectorStore = Depends(get_vectorstore),
):
    """Health endpoint — always returns 200 if server is running."""
    return {
        "status": "ok",
        "model_loaded": llm.is_loaded,
        "model_name": llm.model_name,
        "indexed_chunks": vectorstore.count_chunks(),
    }
