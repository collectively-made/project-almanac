from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from backend.db import Database
from backend.rag.fulltext import FullTextSearch
from backend.rag.retriever import Retriever
from backend.rag.vectorstore import VectorStore

logger = logging.getLogger("almanac.content")


def _directory_hash(pack_dir: Path) -> str:
    """Hash all JSONL files in a pack directory for change detection."""
    h = hashlib.sha256()
    for f in sorted(pack_dir.rglob("*.jsonl")):
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def _load_chunks_from_jsonl(jsonl_path: Path) -> list[dict]:
    """Load chunks from a JSONL file. Each line is a JSON object."""
    chunks = []
    for line_num, line in enumerate(jsonl_path.read_text().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            chunk = json.loads(line)
            if "chunk_id" not in chunk:
                chunk["chunk_id"] = f"{jsonl_path.stem}_{line_num}"
            if "text" not in chunk:
                logger.warning("Chunk missing 'text' field at %s:%d", jsonl_path, line_num)
                continue
            if "source" not in chunk:
                chunk["source"] = jsonl_path.stem
            chunks.append(chunk)
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON at %s:%d: %s", jsonl_path, line_num, e)
    return chunks


def _load_precomputed_embeddings(pack_dir: Path, chunk_ids: list[str]) -> Optional[np.ndarray]:
    """Try to load pre-computed embeddings from .npy files."""
    vec_dir = pack_dir / "embeddings"
    if not vec_dir.exists():
        return None

    # Look for a single embeddings.npy file
    npy_path = vec_dir / "embeddings.npy"
    if npy_path.exists():
        embeddings = np.load(str(npy_path))
        if embeddings.shape[0] == len(chunk_ids):
            logger.info("Loaded pre-computed embeddings from %s", npy_path)
            return embeddings.astype(np.float32)
        else:
            logger.warning(
                "Embedding count mismatch: %d embeddings vs %d chunks",
                embeddings.shape[0], len(chunk_ids),
            )
    return None


async def load_content_packs(
    builtin_dir: Path,
    content_dir: Path,
    db: Database,
    vectorstore: VectorStore,
    fulltext: FullTextSearch,
    retriever: Retriever,
) -> int:
    """Scan and index content packs from builtin and user directories.

    Returns total number of chunks indexed.
    """
    total_indexed = 0

    # Initialize storage tables
    vectorstore.init_tables()
    fulltext.init_tables()

    # Scan both directories for pack subdirectories
    pack_dirs: list[tuple[Path, str]] = []  # (path, source_type)

    for scan_dir, source_type in [(builtin_dir, "builtin"), (content_dir, "user")]:
        packs_dir = scan_dir / "packs" if (scan_dir / "packs").exists() else scan_dir
        if not packs_dir.exists():
            continue
        for entry in sorted(packs_dir.iterdir()):
            if entry.is_dir() and list(entry.glob("*.jsonl")):
                pack_dirs.append((entry, source_type))

    for pack_dir, source_type in pack_dirs:
        pack_id = pack_dir.name
        dir_hash = _directory_hash(pack_dir)

        # Check if already indexed with same hash
        rows = await db.execute(
            "SELECT directory_hash FROM content_pack_index WHERE pack_id = ?",
            (pack_id,),
        )
        if rows and rows[0][0] == dir_hash:
            logger.info("Pack '%s' already indexed (hash match), skipping", pack_id)
            count_rows = await db.execute(
                "SELECT chunk_count FROM content_pack_index WHERE pack_id = ?",
                (pack_id,),
            )
            total_indexed += count_rows[0][0] if count_rows else 0
            continue

        logger.info("Indexing pack '%s' from %s (%s)", pack_id, pack_dir, source_type)

        # Load all chunks from JSONL files
        chunks = []
        for jsonl_file in sorted(pack_dir.glob("*.jsonl")):
            file_chunks = _load_chunks_from_jsonl(jsonl_file)
            for c in file_chunks:
                c.setdefault("domain", pack_id)
            chunks.extend(file_chunks)

        if not chunks:
            logger.warning("Pack '%s' has no valid chunks, skipping", pack_id)
            continue

        # Try pre-computed embeddings first
        chunk_ids = [c["chunk_id"] for c in chunks]
        embeddings = _load_precomputed_embeddings(pack_dir, chunk_ids)

        if embeddings is None:
            # Compute embeddings on-device
            logger.info("Computing embeddings for %d chunks (no pre-computed found)", len(chunks))
            texts = [c["text"] for c in chunks]
            embeddings = retriever.embed_texts(texts)

        # Index into vector store and FTS5
        vec_count = vectorstore.index_chunks(chunks, embeddings, pack_id=pack_id)
        fts_count = fulltext.index_chunks(chunks)

        # Record in index
        await db.execute(
            """INSERT OR REPLACE INTO content_pack_index
            (pack_id, directory_hash, chunk_count, indexed_at)
            VALUES (?, ?, ?, ?)""",
            (pack_id, dir_hash, vec_count, datetime.now(timezone.utc).isoformat()),
        )

        total_indexed += vec_count
        logger.info(
            "Pack '%s': indexed %d chunks (vec=%d, fts=%d)",
            pack_id, len(chunks), vec_count, fts_count,
        )

    return total_indexed
