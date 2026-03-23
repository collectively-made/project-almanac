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

PROFILE_SYSTEM_PROMPT = """You are Almanac, a survival and homesteading assistant. You are asking the user questions to learn about their situation so you can give better advice later.

RULES:
- Ask ONE short question at a time
- Do NOT give advice yet, just learn about them
- Do NOT talk about passwords, emails, usernames, or social media
- This is about their REAL LIFE situation: where they live, their home, their land

Start by asking where they live (city and state).

Then ask about these topics ONE AT A TIME:
1. Where they live (city/state)
2. Type of home (house, apartment, cabin) and how much land
3. How many people in household
4. Water source (city water, well, spring)
5. Power (grid, solar, generator)
6. Do they garden or grow food
7. Do they keep animals/livestock
8. Experience level (beginner, intermediate, experienced)
9. What they want to focus on (preparedness, food growing, off-grid living)

After you have asked about 5+ topics, write "PROFILE COMPLETE" and output this JSON:

```json
{"profile": {"region_description": "...", "dwelling": "...", "setting": "...", "property_size": "...", "household_size": 4, "children": "...", "pets": "...", "water_source": "...", "power": "...", "has_garden": true, "garden_details": "...", "livestock": "...", "food_storage": "...", "experience_level": "...", "priorities": "..."}}
```

Only include fields the user actually told you about."""


class HistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")  # Only user/assistant, never system
    content: str = Field(..., max_length=4096)


class ProfileChatRequest(BaseModel):
    message: str = Field(..., max_length=2048)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)


from backend.api.sse import sse_event as _sse_event


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
                from backend.api.context import UserProfile
                validated = UserProfile(**profile_data).model_dump(exclude_none=True)
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
