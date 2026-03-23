from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.db import Database
from backend.dependencies import get_database, get_llm_manager
from backend.llm.manager import LLMManager

logger = logging.getLogger("almanac.profile_chat")
router = APIRouter()

PROFILE_SYSTEM_PROMPT = """You are helping a user set up their profile for Almanac, a survival and homesteading knowledge platform. Your job is to learn about them through natural conversation so you can personalize future answers.

Have a friendly, natural conversation. Ask ONE question at a time. Adapt based on their answers — don't ask about livestock details if they said they don't have any. Don't ask about garden specifics if they live in an apartment with no outdoor space.

Topics to cover (in a natural order, skip what doesn't apply):
- Where they live (city/state or general area)
- Living situation (house, apartment, land size)
- Household (how many people, any special needs)
- Water and power infrastructure
- Food production (garden, livestock, food storage)
- Experience level with homesteading/preparedness
- What they're focused on or preparing for

Keep it conversational and brief. After 5-8 exchanges (or when you have a good picture), say something like "I think I have a good picture now!" and then output a JSON block with the profile data in this exact format:

```json
{"profile": {"region_description": "...", "dwelling": "...", "setting": "...", "property_size": "...", "household_size": 4, "children": "...", "pets": "...", "water_source": "...", "power": "...", "has_garden": true, "garden_details": "...", "livestock": "...", "food_storage": "...", "experience_level": "...", "priorities": "...", "notes": "..."}}
```

Only include fields you actually learned about. Use null for fields not discussed. The JSON block signals the system to save the profile.

IMPORTANT: Keep questions SHORT. One question per message. Be warm but efficient. The user wants to get to using the app, not fill out a form."""


class HistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")  # Only user/assistant, never system
    content: str = Field(..., max_length=4096)


class ProfileChatRequest(BaseModel):
    message: str = Field(..., max_length=2048)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)


def _sse_event(event: str, **kwargs) -> dict:
    return {"event": event, "data": json.dumps({"event": event, **kwargs})}


def _extract_profile_json(text: str) -> dict | None:
    """Try to extract a profile JSON block from the LLM response."""
    # Look for ```json ... ``` blocks
    match = re.search(r'```json\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            if "profile" in data:
                return data["profile"]
        except json.JSONDecodeError:
            pass

    # Try finding raw JSON with "profile" key
    match = re.search(r'\{"profile":\s*\{.*?\}\}', text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            return data.get("profile")
        except json.JSONDecodeError:
            pass

    return None


async def _stream_profile_chat(
    request: Request,
    llm: LLMManager,
    db: Database,
    message: str,
    history: list[HistoryMessage],
):
    """Run a profile-building conversation with the LLM."""
    full_response = ""

    try:
        messages = [{"role": "system", "content": PROFILE_SYSTEM_PROMPT}]
        # Only allow user/assistant roles — validated by Pydantic
        messages.extend({"role": m.role, "content": m.content} for m in history)
        messages.append({"role": "user", "content": message})

        async for token in llm.chat(
            messages=messages,
            max_tokens=1024,
            temperature=0.7,  # Slightly more creative for conversation
        ):
            if await request.is_disconnected():
                return
            full_response += token
            yield _sse_event("token", text=token)

        # Check if the response contains a profile JSON
        profile_data = _extract_profile_json(full_response)
        if profile_data:
            # Validate through UserProfile schema before saving
            try:
                from backend.api.context import UserProfile, _ensure_table
                validated = UserProfile(**profile_data).model_dump(exclude_none=True)
                await _ensure_table(db)
                await db.execute(
                    """INSERT OR REPLACE INTO user_profile (key, data, updated_at)
                    VALUES ('default', ?, datetime('now'))""",
                    (json.dumps(validated),),
                )
                logger.info("Profile saved from conversation: %d fields", len(validated))
                yield _sse_event("profile_saved", fields=len(validated))
            except Exception as e:
                logger.exception("Failed to save profile from conversation")

        yield _sse_event("done", confidence=1.0, sources=[], tokens_generated=len(full_response.split()))

    except RuntimeError as e:
        yield _sse_event("error", message=str(e), recoverable=True)
    except Exception:
        logger.exception("Error in profile chat")
        yield _sse_event("error", message="Error during conversation", recoverable=False)


@router.post("/api/profile/chat")
async def profile_chat(
    request: Request,
    body: ProfileChatRequest,
    llm: LLMManager = Depends(get_llm_manager),
    db: Database = Depends(get_database),
):
    if not llm.is_loaded:
        return EventSourceResponse(
            iter([_sse_event("error", message="No model loaded yet.", recoverable=True)]),
            media_type="text/event-stream",
            status_code=503,
        )

    if llm.is_busy:
        return EventSourceResponse(
            iter([_sse_event("error", message="Model is busy. Try again shortly.", recoverable=True)]),
            media_type="text/event-stream",
            status_code=503,
        )

    return EventSourceResponse(
        _stream_profile_chat(request, llm, db, body.message, body.history),
        media_type="text/event-stream",
    )
