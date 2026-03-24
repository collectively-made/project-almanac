"""LLM provider management — local vs cloud routing."""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.db import Database
from backend.dependencies import get_database

logger = logging.getLogger("almanac.provider")
router = APIRouter()


class SetProviderRequest(BaseModel):
    provider: str = Field(..., pattern="^(local|anthropic|openai)$")
    api_key: Optional[str] = Field(None, min_length=10, max_length=200)
    model: Optional[str] = Field(None, max_length=100)


async def get_active_provider(db: Database) -> dict:
    """Get the currently active LLM provider config."""
    try:
        rows = await db.execute(
            "SELECT data FROM provider_config WHERE key = 'active'"
        )
        if rows:
            return json.loads(rows[0][0])
    except Exception:
        pass
    return {"provider": "local", "api_key": None, "model": None}


async def _ensure_table(db: Database):
    await db.execute("""
        CREATE TABLE IF NOT EXISTS provider_config (
            key TEXT PRIMARY KEY DEFAULT 'active',
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


@router.get("/api/provider")
async def get_provider(db: Database = Depends(get_database)):
    """Get the active LLM provider (local, anthropic, or openai)."""
    await _ensure_table(db)
    config = await get_active_provider(db)
    # Don't expose full API key
    safe = {
        "provider": config.get("provider", "local"),
        "model": config.get("model"),
        "has_api_key": bool(config.get("api_key")),
    }
    return safe


@router.post("/api/provider")
async def set_provider(
    body: SetProviderRequest,
    db: Database = Depends(get_database),
):
    """Set the LLM provider. Requires API key for cloud providers."""
    await _ensure_table(db)

    if body.provider in ("anthropic", "openai") and not body.api_key:
        raise HTTPException(400, "API key required for cloud providers")

    config = {
        "provider": body.provider,
        "api_key": body.api_key,
        "model": body.model,
    }

    await db.execute(
        """INSERT OR REPLACE INTO provider_config (key, data, updated_at)
        VALUES ('active', ?, datetime('now'))""",
        (json.dumps(config),),
    )

    logger.info("Provider set to: %s", body.provider)
    return {"status": "saved", "provider": body.provider}


@router.delete("/api/provider")
async def reset_provider(db: Database = Depends(get_database)):
    """Reset to local provider."""
    await _ensure_table(db)
    await db.execute("DELETE FROM provider_config WHERE key = 'active'")
    return {"status": "reset", "provider": "local"}
