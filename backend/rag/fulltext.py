from __future__ import annotations

import logging
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from backend.pipeline.types import ScoredChunk

logger = logging.getLogger("almanac.rag.fulltext")


class FullTextSearch:
    """SQLite FTS5 wrapper for BM25 keyword search."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._local = threading.local()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self._db_path))
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            self._local.conn = conn
        return self._local.conn

    def init_tables(self) -> None:
        conn = self._get_conn()
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(
                chunk_id,
                text,
                source,
                section,
                content='',
                tokenize='porter unicode61'
            )
        """)
        conn.commit()
        logger.info("FTS5 tables initialized")

    def index_chunks(self, chunks: list[dict]) -> int:
        conn = self._get_conn()
        indexed = 0
        for chunk in chunks:
            try:
                conn.execute(
                    "INSERT INTO chunks_fts(rowid, chunk_id, text, source, section) VALUES (?, ?, ?, ?, ?)",
                    (
                        hash(chunk["chunk_id"]) & 0x7FFFFFFFFFFFFFFF,  # Positive int64
                        chunk["chunk_id"],
                        chunk["text"],
                        chunk["source"],
                        chunk.get("section", ""),
                    ),
                )
                indexed += 1
            except Exception as e:
                logger.warning("FTS index failed for %s: %s", chunk.get("chunk_id", "?"), e)
        conn.commit()
        return indexed

    def search(self, query: str, top_k: int = 20) -> list[ScoredChunk]:
        """BM25 search. Returns chunks ranked by relevance."""
        conn = self._get_conn()

        # Sanitize: tokenize and wrap each term in quotes with proper escaping
        import re as _re
        words = _re.findall(r'\w+', query)  # Extract only word characters
        if not words:
            return []
        # Each term individually quoted and escaped for FTS5
        safe_terms = " ".join(
            '"' + w.replace('"', '""') + '"' for w in words if len(w) > 1
        )
        if not safe_terms:
            return []

        try:
            rows = conn.execute(
                """
                SELECT
                    chunk_id,
                    text,
                    source,
                    section,
                    rank
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (safe_terms, top_k),
            ).fetchall()
        except Exception:
            # Fallback: try individual terms with OR
            or_terms = " OR ".join(
                '"' + w.replace('"', '""') + '"' for w in words if len(w) > 2
            )
            if not or_terms:
                return []
            try:
                rows = conn.execute(
                    """
                    SELECT chunk_id, text, source, section, rank
                    FROM chunks_fts
                    WHERE chunks_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                    (or_terms, top_k),
                ).fetchall()
            except Exception:
                return []

        results = []
        for chunk_id, text, source, section, rank in rows:
            # FTS5 rank is negative (lower = better). Normalize to 0-1.
            score = 1.0 / (1.0 + abs(rank))
            results.append(
                ScoredChunk(
                    chunk_id=chunk_id,
                    text=text,
                    source=source,
                    section=section,
                    score=score,
                    dense_score=0.0,
                    sparse_score=score,
                    safety_tier="guarded",
                )
            )
        return results

    def delete_pack_chunks(self, chunk_ids: list[str]) -> None:
        conn = self._get_conn()
        for cid in chunk_ids:
            rowid = hash(cid) & 0x7FFFFFFFFFFFFFFF
            conn.execute("DELETE FROM chunks_fts WHERE rowid = ?", (rowid,))
        conn.commit()
