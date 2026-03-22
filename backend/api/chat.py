from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.dependencies import get_llm_manager, get_retriever
from backend.llm.manager import LLMManager
from backend.rag.retriever import Retriever

logger = logging.getLogger("almanac.chat")
router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2048)


def _sse_event(event: str, **kwargs) -> dict:
    return {"event": event, "data": json.dumps({"event": event, **kwargs})}


SYSTEM_PROMPT = (
    "You are a homesteading and off-grid living assistant. "
    "Answer questions using ONLY the provided source material. "
    "If the sources don't contain relevant information, say so honestly. "
    "If a question is outside homesteading topics, decline to answer. "
    "Be practical and concise. Cite which source you used."
)


def _build_messages(message: str, chunks: list, grounded: bool) -> list[dict]:
    """Build chat messages for the LLM's chat completion API."""
    if chunks and grounded:
        context_parts = []
        for i, chunk in enumerate(chunks[:3], 1):
            context_parts.append(
                f"[Source {i}: {chunk.source} — {chunk.section}]\n{chunk.text}"
            )
        context = "\n\n".join(context_parts)
        system = f"{SYSTEM_PROMPT}\n\nSource Material:\n\n{context}"
    else:
        system = (
            f"{SYSTEM_PROMPT}\n\n"
            "No relevant source material was found. "
            "Let the user know you cannot provide a well-sourced answer."
        )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": message},
    ]


async def _stream_response(
    request: Request,
    llm: LLMManager,
    retriever: Retriever,
    message: str,
):
    """Generate SSE events with RAG-grounded responses."""
    tokens_generated = 0

    try:
        # Step 1: Retrieve relevant chunks
        chunks, confidence, grounded = await retriever.retrieve(
            query=message,
            top_k=settings.retrieval_top_k,
            min_score=settings.min_retrieval_score,
        )

        # Step 2: Build chat messages with context
        messages = _build_messages(message, chunks, grounded)

        # Step 3: Stream LLM response via chat completion
        async for token in llm.chat(
            messages=messages,
            max_tokens=2048,
            temperature=0.3,
        ):
            if await request.is_disconnected():
                logger.info("Client disconnected during streaming")
                return
            tokens_generated += 1
            yield _sse_event("token", text=token)

        # Step 4: Send metadata with done event — include chunk excerpts
        yield _sse_event(
            "done",
            confidence=round(confidence, 2),
            grounded=grounded,
            sources=[
                {
                    "source": c.source,
                    "section": c.section,
                    "excerpt": c.text[:300],
                    "score": round(c.dense_score, 3),
                }
                for c in chunks[:6]  # Top 6 chunks with excerpts
            ],
            tokens_generated=tokens_generated,
        )

    except RuntimeError as e:
        yield _sse_event("error", message=str(e), recoverable=True)
    except Exception as e:
        logger.exception("Error during generation")
        yield _sse_event(
            "error", message="Internal error during generation", recoverable=False
        )


@router.post("/api/chat")
async def chat(
    request: Request,
    body: ChatRequest,
    llm: LLMManager = Depends(get_llm_manager),
    retriever: Retriever = Depends(get_retriever),
):
    if not llm.is_loaded:
        return EventSourceResponse(
            iter(
                [
                    _sse_event(
                        "error",
                        message="No model loaded. Please load a model first.",
                        recoverable=True,
                    )
                ]
            ),
            media_type="text/event-stream",
            status_code=503,
        )

    if llm.is_busy:
        return EventSourceResponse(
            iter(
                [
                    _sse_event(
                        "error",
                        message="Model is busy processing another request. Try again shortly.",
                        recoverable=True,
                    )
                ]
            ),
            media_type="text/event-stream",
            status_code=503,
        )

    return EventSourceResponse(
        _stream_response(request, llm, retriever, body.message),
        media_type="text/event-stream",
    )
