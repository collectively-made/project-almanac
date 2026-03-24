from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.dependencies import get_llm_manager
from backend.llm.manager import LLMManager

logger = logging.getLogger("almanac.models")
router = APIRouter()


class LoadModelRequest(BaseModel):
    name: str


@router.get("/api/models")
async def list_models(llm: LLMManager = Depends(get_llm_manager)):
    """List available GGUF models in the models directory."""
    models = llm.list_models()
    return {
        "models": models,
        "active": llm.model_name,
    }


@router.post("/api/models/load")
async def load_model(
    body: LoadModelRequest,
    llm: LLMManager = Depends(get_llm_manager),
):
    """Load a specific GGUF model."""
    try:
        await llm.load_model(body.name)
        return {"status": "ok", "model": body.name}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model not found")
    except MemoryError:
        raise HTTPException(status_code=507, detail="Insufficient memory. Try a smaller model.")
    except ImportError:
        raise HTTPException(status_code=501, detail="LLM runtime not installed")
    except Exception:
        logger.exception("Failed to load model")
        raise HTTPException(status_code=500, detail="Failed to load model")


@router.post("/api/models/unload")
async def unload_model(llm: LLMManager = Depends(get_llm_manager)):
    """Unload the current model to free RAM."""
    if not llm.is_loaded:
        return {"status": "ok", "message": "No model loaded"}
    name = llm.model_name
    llm._llm = None
    llm._model_name = None
    logger.info("Model unloaded: %s", name)
    return {"status": "ok", "unloaded": name}
