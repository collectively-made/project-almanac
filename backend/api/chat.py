from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.dependencies import get_llm_manager
from backend.llm.manager import LLMManager

logger = logging.getLogger("almanac.chat")
router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2048)


def _sse_event(event: str, **kwargs) -> dict:
    return {"event": event, "data": json.dumps({"event": event, **kwargs})}


async def _stream_response(request: Request, llm: LLMManager, message: str):
    """Generate SSE events: token, done, or error."""
    tokens_generated = 0
    full_text = ""

    try:
        # Build prompt with system instructions
        prompt = (
            "You are a homesteading and off-grid living assistant. "
            "Answer questions about food preservation, gardening, animal husbandry, "
            "solar power, construction, and related topics. "
            "If a question is outside your knowledge domain, say so. "
            "Be practical and cite specific techniques.\n\n"
            f"User: {message}\n\n"
            "Assistant:"
        )

        async for token in llm.generate(
            prompt=prompt,
            max_tokens=512,
            temperature=0.3,
        ):
            if await request.is_disconnected():
                logger.info("Client disconnected during streaming")
                return
            tokens_generated += 1
            full_text += token
            yield _sse_event("token", text=token)

        yield _sse_event(
            "done",
            confidence=0.0,  # Will be populated when RAG is added
            sources=[],
            tokens_generated=tokens_generated,
        )
    except RuntimeError as e:
        yield _sse_event("error", message=str(e), recoverable=True)
    except Exception as e:
        logger.exception("Error during generation")
        yield _sse_event("error", message="Internal error during generation", recoverable=False)


@router.post("/api/chat")
async def chat(
    request: Request,
    body: ChatRequest,
    llm: LLMManager = Depends(get_llm_manager),
):
    if not llm.is_loaded:
        return EventSourceResponse(
            iter([_sse_event("error", message="No model loaded. Please load a model first.", recoverable=True)]),
            media_type="text/event-stream",
            status_code=503,
        )

    # Check if model is busy
    if llm.is_busy:
        return EventSourceResponse(
            iter([_sse_event("error", message="Model is busy processing another request. Try again shortly.", recoverable=True)]),
            media_type="text/event-stream",
            status_code=503,
        )

    return EventSourceResponse(
        _stream_response(request, llm, body.message),
        media_type="text/event-stream",
    )
