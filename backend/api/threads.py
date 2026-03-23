from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.db import Database
from backend.dependencies import get_database

logger = logging.getLogger("almanac.threads")
router = APIRouter()


class CreateThreadRequest(BaseModel):
    title: str = Field(default="New conversation", max_length=200)


class UpdateThreadRequest(BaseModel):
    title: str = Field(..., max_length=200)


class SaveMessageRequest(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=50000)
    confidence: float | None = None
    sources: list[dict] | None = None
    grounded: bool | None = None


@router.get("/api/threads")
async def list_threads(db: Database = Depends(get_database)):
    """List all threads, most recent first."""
    rows = await db.execute(
        """SELECT t.id, t.title, t.created_at, t.updated_at,
                  (SELECT COUNT(*) FROM thread_messages WHERE thread_id = t.id) as message_count
           FROM threads t
           ORDER BY t.updated_at DESC"""
    )
    return [
        {
            "id": r[0],
            "title": r[1],
            "created_at": r[2],
            "updated_at": r[3],
            "message_count": r[4],
        }
        for r in rows
    ]


@router.post("/api/threads")
async def create_thread(
    body: CreateThreadRequest = CreateThreadRequest(),
    db: Database = Depends(get_database),
):
    """Create a new conversation thread."""
    thread_id = str(uuid.uuid4())[:8]
    await db.execute(
        "INSERT INTO threads (id, title) VALUES (?, ?)",
        (thread_id, body.title),
    )
    return {"id": thread_id, "title": body.title}


@router.get("/api/threads/{thread_id}")
async def get_thread(thread_id: str, db: Database = Depends(get_database)):
    """Get a thread with all its messages."""
    rows = await db.execute(
        "SELECT id, title, created_at, updated_at FROM threads WHERE id = ?",
        (thread_id,),
    )
    if not rows:
        raise HTTPException(404, "Thread not found")

    thread = {"id": rows[0][0], "title": rows[0][1], "created_at": rows[0][2], "updated_at": rows[0][3]}

    msg_rows = await db.execute(
        """SELECT role, content, confidence, sources, grounded, created_at
           FROM thread_messages
           WHERE thread_id = ?
           ORDER BY created_at ASC""",
        (thread_id,),
    )
    messages = []
    for r in msg_rows:
        msg: dict = {"role": r[0], "content": r[1]}
        if r[2] is not None:
            msg["confidence"] = r[2]
        if r[3]:
            try:
                msg["sources"] = json.loads(r[3])
            except (json.JSONDecodeError, TypeError):
                pass
        if r[4] is not None:
            msg["grounded"] = bool(r[4])
        messages.append(msg)

    thread["messages"] = messages
    return thread


@router.patch("/api/threads/{thread_id}")
async def update_thread(
    thread_id: str,
    body: UpdateThreadRequest,
    db: Database = Depends(get_database),
):
    """Update a thread's title."""
    rows = await db.execute("SELECT id FROM threads WHERE id = ?", (thread_id,))
    if not rows:
        raise HTTPException(404, "Thread not found")
    await db.execute(
        "UPDATE threads SET title = ?, updated_at = datetime('now') WHERE id = ?",
        (body.title, thread_id),
    )
    return {"id": thread_id, "title": body.title}


@router.delete("/api/threads/{thread_id}")
async def delete_thread(thread_id: str, db: Database = Depends(get_database)):
    """Delete a thread and all its messages."""
    await db.execute("DELETE FROM thread_messages WHERE thread_id = ?", (thread_id,))
    await db.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
    return {"deleted": thread_id}


@router.post("/api/threads/{thread_id}/messages")
async def save_message(
    thread_id: str,
    body: SaveMessageRequest,
    db: Database = Depends(get_database),
):
    """Save a message to a thread."""
    rows = await db.execute("SELECT id FROM threads WHERE id = ?", (thread_id,))
    if not rows:
        raise HTTPException(404, "Thread not found")

    sources_json = json.dumps(body.sources) if body.sources else None

    await db.execute(
        """INSERT INTO thread_messages (thread_id, role, content, confidence, sources, grounded)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (thread_id, body.role, body.content, body.confidence, sources_json, body.grounded),
    )

    # Update thread timestamp
    await db.execute(
        "UPDATE threads SET updated_at = datetime('now') WHERE id = ?",
        (thread_id,),
    )

    # Auto-title: if this is the first user message, use it as the title
    count_rows = await db.execute(
        "SELECT COUNT(*) FROM thread_messages WHERE thread_id = ? AND role = 'user'",
        (thread_id,),
    )
    if count_rows and count_rows[0][0] == 1 and body.role == "user":
        # First user message — use it as the title (truncated)
        title = body.content[:80].strip()
        if len(body.content) > 80:
            title += "..."
        await db.execute(
            "UPDATE threads SET title = ? WHERE id = ?",
            (title, thread_id),
        )

    return {"status": "saved"}
