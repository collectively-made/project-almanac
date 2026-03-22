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
        raise HTTPException(status_code=404, detail=f"Model not found: {body.name}")
    except MemoryError as e:
        raise HTTPException(status_code=507, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.exception("Failed to load model")
        raise HTTPException(status_code=500, detail=f"Failed to load model: {e}")
