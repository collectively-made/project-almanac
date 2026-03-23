from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.api.context import UserProfile, profile_to_prompt_context
from backend.config import settings
from backend.db import Database
from backend.dependencies import get_database, get_llm_manager, get_retriever
from backend.llm.manager import LLMManager
from backend.rag.retriever import Retriever

logger = logging.getLogger("almanac.chat")
router = APIRouter()


class ChatHistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=4096)


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2048)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=10)


from backend.api.sse import sse_event as _sse_event


SYSTEM_PROMPT = (
    "You are a survival and homesteading knowledge assistant. "
    "Answer questions using the provided source material and user context. "
    "Tailor your response to the user's specific situation — their location, "
    "living situation, experience level, and resources.\n\n"
    "IMPORTANT GUIDELINES:\n"
    "- If the user has provided their location, use your knowledge to infer "
    "their USDA hardiness zone, climate type, growing season, and local conditions. "
    "For example, 'Lincoln, Nebraska' means Zone 5b, last frost around May 1, "
    "first frost around October 10, cold continental climate.\n"
    "- Adapt advice to the user's experience level. Beginners need more explanation; "
    "experienced users want specifics.\n"
    "- If the user's profile indicates constraints (apartment, small lot, no garden), "
    "tailor advice accordingly (container gardening, indoor options, etc.).\n"
    "- If you need critical context to give a useful answer and the user hasn't "
    "provided it in their profile, ask ONE focused clarifying question.\n"
    "- If the sources don't contain relevant information, say so honestly.\n"
    "- Be practical and concise. Cite which source you used."
)


def _build_messages(
    message: str,
    chunks: list,
    grounded: bool,
    user_context: str = "",
    history: list[ChatHistoryMessage] | None = None,
) -> list[dict]:
    """Build chat messages for the LLM's chat completion API."""
    system_parts = [SYSTEM_PROMPT]

    # Inject user context if available
    if user_context:
        system_parts.append(user_context)

    if chunks and grounded:
        context_parts = []
        doc_refs = []
        seen_files = set()
        for i, chunk in enumerate(chunks[:3], 1):
            context_parts.append(
                f"[Source {i}: {chunk.source} — {chunk.section}]\n{chunk.text}"
            )
            if chunk.source_file and chunk.source_file not in seen_files:
                seen_files.add(chunk.source_file)
                doc_refs.append(
                    f"- {chunk.source}: /api/files/{chunk.pack_id}/{chunk.source_file}"
                )
        context = "\n\n".join(context_parts)
        system_parts.append(f"## Source Material\n\n{context}")

        if doc_refs:
            system_parts.append(
                "## Available Documents\n\n"
                "These full documents are stored locally and available to the user. "
                "If you are drawing heavily from one or the user would benefit from reading "
                "the full document (e.g. for diagrams, detailed tables, or step-by-step procedures), "
                "you may reference it inline like: **[Document Title ↗](url)**\n"
                "Only reference a document when it adds real value — not for every response.\n\n"
                + "\n".join(doc_refs)
            )
    else:
        system_parts.append(
            "No relevant source material was found. "
            "Let the user know you cannot provide a well-sourced answer."
        )

    system = "\n\n".join(system_parts)

    messages: list[dict] = [{"role": "system", "content": system}]

    # Add conversation history for multi-turn context
    if history:
        for h in history:
            messages.append({"role": h.role, "content": h.content})

    messages.append({"role": "user", "content": message})
    return messages


async def _load_user_context(db: Database) -> str:
    """Load user profile and convert to prompt context string."""
    try:
        rows = await db.execute(
            "SELECT data FROM user_profile WHERE key = 'default'"
        )
        if rows:
            profile = UserProfile(**json.loads(rows[0][0]))
            return profile_to_prompt_context(profile)
    except Exception:
        pass  # Table may not exist yet
    return ""


async def _stream_response(
    request: Request,
    llm: LLMManager,
    retriever: Retriever,
    db: Database,
    message: str,
    history: list[ChatHistoryMessage] | None = None,
):
    """Generate SSE events with RAG-grounded, context-aware responses."""
    tokens_generated = 0

    try:
        # Step 1: Load user context
        user_context = await _load_user_context(db)

        # Step 2: Retrieve relevant chunks
        chunks, confidence, grounded = await retriever.retrieve(
            query=message,
            top_k=settings.retrieval_top_k,
            min_score=settings.min_retrieval_score,
        )

        # Step 3: Build chat messages with context + conversation history
        messages = _build_messages(message, chunks, grounded, user_context, history)

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

        # Step 4: Build sources and documents lists
        sources_list = []
        documents_list = []
        seen_docs = set()

        for c in chunks[:6]:
            sources_list.append({
                "source": c.source,
                "section": c.section,
                "excerpt": c.text[:300],
                "score": round(c.dense_score, 3),
            })
            # Collect unique documents
            if c.source_file and c.source_file not in seen_docs:
                seen_docs.add(c.source_file)
                documents_list.append({
                    "title": c.source,
                    "filename": c.source_file,
                    "pack_id": c.pack_id,
                    "url": f"/api/files/{c.pack_id}/{c.source_file}",
                })

        yield _sse_event(
            "done",
            confidence=round(confidence, 2),
            grounded=grounded,
            sources=sources_list,
            documents=documents_list,
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
    db: Database = Depends(get_database),
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
        _stream_response(request, llm, retriever, db, body.message, body.history or None),
        media_type="text/event-stream",
    )
