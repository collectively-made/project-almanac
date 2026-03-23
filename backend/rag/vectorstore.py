from __future__ import annotations

import logging
import sqlite3
import struct
import threading
from pathlib import Path
from typing import Optional

import numpy as np
import sqlite_vec

from backend.pipeline.types import ScoredChunk

logger = logging.getLogger("almanac.rag.vectorstore")

EMBEDDING_DIM = 384  # all-MiniLM-L6-v2


class VectorStore:
    """sqlite-vec backed vector store with float32 vectors.

    Uses thread-local SQLite connections for async-safe access.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._local = threading.local()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self._db_path))
            conn.enable_load_extension(True)
            sqlite_vec.load(conn)
            conn.enable_load_extension(False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            self._local.conn = conn
        return self._local.conn

    def init_tables(self) -> None:
        conn = self._get_conn()
        # Chunks metadata table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                rowid INTEGER PRIMARY KEY,
                chunk_id TEXT UNIQUE NOT NULL,
                text TEXT NOT NULL,
                source TEXT NOT NULL,
                section TEXT NOT NULL DEFAULT '',
                domain TEXT NOT NULL DEFAULT '',
                safety_tier TEXT NOT NULL DEFAULT 'guarded',
                pack_id TEXT NOT NULL DEFAULT '',
                source_file TEXT NOT NULL DEFAULT ''
            )
        """)
        # Vector index — float32 for simplicity and compatibility
        conn.execute(f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec
            USING vec0(embedding float[{EMBEDDING_DIM}])
        """)
        conn.commit()
        logger.info("Vector store tables initialized")

    def index_chunks(
        self,
        chunks: list[dict],
        embeddings: np.ndarray,
        pack_id: str = "",
    ) -> int:
        """Index chunks with their embeddings.

        chunks: list of dicts with keys: chunk_id, text, source, section, domain, safety_tier
        embeddings: numpy array of shape (n_chunks, EMBEDDING_DIM), float32
        """
        conn = self._get_conn()
        indexed = 0

        for i, chunk in enumerate(chunks):
            try:
                # Insert metadata
                conn.execute(
                    """INSERT OR REPLACE INTO chunks
                    (chunk_id, text, source, section, domain, safety_tier, pack_id, source_file)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        chunk["chunk_id"],
                        chunk["text"],
                        chunk["source"],
                        chunk.get("section", ""),
                        chunk.get("domain", ""),
                        chunk.get("safety_tier", "guarded"),
                        pack_id,
                        chunk.get("source_file", ""),
                    ),
                )
                rowid = conn.execute(
                    "SELECT rowid FROM chunks WHERE chunk_id = ?",
                    (chunk["chunk_id"],),
                ).fetchone()[0]

                # Insert vector
                vec = embeddings[i].astype(np.float32).tobytes()
                conn.execute(
                    "INSERT OR REPLACE INTO chunks_vec(rowid, embedding) VALUES (?, ?)",
                    (rowid, vec),
                )
                indexed += 1
            except Exception as e:
                logger.warning("Failed to index chunk %s: %s", chunk.get("chunk_id", i), e)

        conn.commit()
        logger.info("Indexed %d/%d chunks for pack %s", indexed, len(chunks), pack_id)
        return indexed

    def search(
        self,
        query_embedding: np.ndarray,
        top_k: int = 10,
        domain: Optional[str] = None,
    ) -> list[ScoredChunk]:
        """KNN search against the vector store.

        Returns ScoredChunk objects sorted by distance (lower = better).
        """
        conn = self._get_conn()
        query_vec = query_embedding.astype(np.float32).tobytes()

        # sqlite-vec requires k=? constraint on KNN queries
        limit = top_k * 3 if domain else top_k
        rows = conn.execute(
            """
            SELECT
                chunks_vec.rowid,
                chunks_vec.distance,
                chunks.chunk_id,
                chunks.text,
                chunks.source,
                chunks.section,
                chunks.safety_tier,
                chunks.source_file,
                chunks.pack_id
            FROM chunks_vec
            JOIN chunks ON chunks.rowid = chunks_vec.rowid
            WHERE embedding MATCH ? AND k = ?
            ORDER BY distance
            """,
            (query_vec, limit),
        ).fetchall()

        results = []
        for row in rows:
            rowid, distance, chunk_id, text, source, section, safety_tier, source_file, pack_id = row
            if domain and domain not in text.lower():
                continue
            # Convert distance to similarity score (1 / (1 + distance))
            score = 1.0 / (1.0 + distance)
            results.append(
                ScoredChunk(
                    chunk_id=chunk_id,
                    text=text,
                    source=source,
                    section=section,
                    score=score,
                    dense_score=score,
                    sparse_score=0.0,
                    safety_tier=safety_tier,
                    source_file=source_file or "",
                    pack_id=pack_id or "",
                )
            )
            if len(results) >= top_k:
                break

        return results

    def count_chunks(self) -> int:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()
        return row[0] if row else 0

    def delete_pack(self, pack_id: str) -> int:
        """Delete all chunks belonging to a content pack."""
        conn = self._get_conn()
        # Get rowids to delete from vec table
        rows = conn.execute(
            "SELECT rowid FROM chunks WHERE pack_id = ?", (pack_id,)
        ).fetchall()
        rowids = [r[0] for r in rows]

        if rowids:
            placeholders = ",".join("?" * len(rowids))
            conn.execute(f"DELETE FROM chunks_vec WHERE rowid IN ({placeholders})", rowids)
            conn.execute("DELETE FROM chunks WHERE pack_id = ?", (pack_id,))
            conn.commit()

        return len(rowids)
