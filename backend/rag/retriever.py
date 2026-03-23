from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np
from fastembed import TextEmbedding

from backend.config import settings
from backend.pipeline.types import ScoredChunk
from backend.rag.fulltext import FullTextSearch
from backend.rag.vectorstore import VectorStore

logger = logging.getLogger("almanac.rag.retriever")


def _reciprocal_rank_fusion(
    dense_results: list[ScoredChunk],
    sparse_results: list[ScoredChunk],
    k: int = 60,
) -> list[ScoredChunk]:
    """Merge dense and sparse results using Reciprocal Rank Fusion.

    RRF score = sum(1 / (k + rank_i)) across all result lists.
    """
    scores: dict[str, float] = {}
    chunk_map: dict[str, ScoredChunk] = {}

    for rank, chunk in enumerate(dense_results):
        scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0) + 1.0 / (k + rank + 1)
        chunk_map[chunk.chunk_id] = chunk

    for rank, chunk in enumerate(sparse_results):
        scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0) + 1.0 / (k + rank + 1)
        if chunk.chunk_id not in chunk_map:
            chunk_map[chunk.chunk_id] = chunk

    # Sort by fused score descending
    sorted_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)

    results = []
    for cid in sorted_ids:
        original = chunk_map[cid]
        results.append(
            ScoredChunk(
                chunk_id=original.chunk_id,
                text=original.text,
                source=original.source,
                section=original.section,
                score=scores[cid],
                dense_score=original.dense_score,
                sparse_score=original.sparse_score,
                safety_tier=original.safety_tier,
                source_file=original.source_file,
                pack_id=original.pack_id,
            )
        )
    return results


class Retriever:
    """Hybrid retriever: FTS5 sparse + sqlite-vec dense + RRF fusion.

    Includes a safety floor: if best retrieval score is below threshold,
    the response is marked as low-confidence.
    """

    def __init__(
        self,
        vectorstore: VectorStore,
        fulltext: FullTextSearch,
        embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> None:
        self._vectorstore = vectorstore
        self._fulltext = fulltext
        self._embedding_model: Optional[TextEmbedding] = None
        self._embedding_model_name = embedding_model_name
        self._executor = ThreadPoolExecutor(max_workers=2)

    def _get_embedding_model(self) -> TextEmbedding:
        """Lazy-load embedding model."""
        if self._embedding_model is None:
            logger.info("Loading embedding model: %s", self._embedding_model_name)
            self._embedding_model = TextEmbedding(self._embedding_model_name)
            logger.info("Embedding model loaded")
        return self._embedding_model

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        """Embed a list of texts. Returns numpy array (n, dim)."""
        model = self._get_embedding_model()
        embeddings = list(model.embed(texts))
        return np.array(embeddings, dtype=np.float32)

    def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query. Returns numpy array (dim,)."""
        return self.embed_texts([query])[0]

    async def retrieve(
        self,
        query: str,
        top_k: int = 10,
        min_score: float = 0.3,
    ) -> tuple[list[ScoredChunk], float, bool]:
        """Retrieve relevant chunks for a query.

        Returns:
            chunks: list of ScoredChunk, sorted by relevance
            confidence: float 0-1, based on best retrieval score
            grounded: bool, True if best score >= min_score
        """
        loop = asyncio.get_running_loop()

        # Run embedding + searches in thread pool (blocking I/O)
        def _search():
            query_embedding = self.embed_query(query)

            # Dense search via sqlite-vec
            dense_results = self._vectorstore.search(
                query_embedding, top_k=top_k
            )

            # Sparse search via FTS5
            sparse_results = self._fulltext.search(query, top_k=top_k)

            # Fuse with RRF
            fused = _reciprocal_rank_fusion(
                dense_results, sparse_results, k=settings.rrf_k
            )

            return fused[:top_k]

        chunks = await loop.run_in_executor(self._executor, _search)

        if not chunks:
            return [], 0.0, False

        # Confidence scoring based on multiple signals:
        # 1. How many chunks were retrieved (more = broader coverage)
        # 2. Best dense score (direct semantic similarity)
        # 3. Whether FTS5 also matched (both systems agree = higher confidence)
        best_dense = max((c.dense_score for c in chunks), default=0.0)
        has_sparse = any(c.sparse_score > 0 for c in chunks)
        num_chunks = len(chunks)

        # Dense similarity is 1/(1+distance), typically 0.3-0.8 for relevant results
        # Scale it to be the primary confidence signal
        confidence = best_dense

        # Boost if both dense and sparse agree (hybrid confirmation)
        if has_sparse and best_dense > 0.2:
            confidence = min(confidence * 1.3, 1.0)

        # Boost slightly for multiple relevant results
        if num_chunks >= 3 and best_dense > 0.3:
            confidence = min(confidence + 0.1, 1.0)

        # Safety floor: is the best result good enough to ground a response?
        grounded = best_dense >= min_score

        return chunks, round(confidence, 2), grounded
