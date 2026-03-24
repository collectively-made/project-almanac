from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.db import Database
from backend.dependencies import get_database, get_llm_manager, get_vectorstore
from backend.llm.manager import LLMManager, _get_available_ram_gb
from backend.rag.vectorstore import VectorStore

from backend.llm.recommender import recommend_models

logger = logging.getLogger("almanac.setup")
router = APIRouter()


@router.get("/api/setup/status")
async def setup_status(
    llm: LLMManager = Depends(get_llm_manager),
    vectorstore: VectorStore = Depends(get_vectorstore),
    db: Database = Depends(get_database),
):
    """Check if the system needs initial setup."""
    models = llm.list_models()
    has_model = len(models) > 0
    model_loaded = llm.is_loaded
    chunks = vectorstore.count_chunks()
    ram_gb = _get_available_ram_gb()

    # Check if cloud provider is configured
    from backend.api.provider import get_active_provider
    provider_config = await get_active_provider(db)
    has_cloud = provider_config.get("provider") in ("anthropic", "openai") and provider_config.get("api_key")

    if has_cloud:
        status = "ready"  # Cloud API configured — no local model needed
    elif not has_model:
        status = "needs_model"
    elif not model_loaded:
        status = "model_available"
    else:
        status = "ready"

    import os
    import platform

    # Get total system RAM (not just available)
    total_ram = ram_gb  # Fallback to available
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total_ram = int(line.split()[1]) / (1024 * 1024)
                    break
    except FileNotFoundError:
        pass  # macOS — _get_available_ram_gb already returns total
    # Detect GPU/unified memory
    is_apple_silicon = platform.processor() == "arm" or "apple" in platform.platform().lower()
    has_gpu = is_apple_silicon  # Simplified — Apple Silicon has Metal
    unified = is_apple_silicon

    recommendations = recommend_models(
        available_ram_gb=total_ram,
        has_gpu=has_gpu,
        gpu_vram_gb=total_ram if unified else 0,
        unified_memory=unified,
        max_results=5,
    )

    return {
        "status": status,
        "has_model": has_model,
        "model_loaded": model_loaded,
        "available_models": models,
        "indexed_chunks": chunks,
        "hardware": {
            "ram_gb": round(total_ram, 1),
            "available_ram_gb": round(ram_gb, 1),
            "cpu_count": os.cpu_count(),
            "gpu": "Apple Silicon (Metal)" if is_apple_silicon else "CPU only",
            "unified_memory": unified,
        },
        "recommended_models": recommendations,
    }


ALLOWED_DOWNLOAD_DOMAINS = {"huggingface.co", "hf-mirror.com"}
MAX_MODEL_SIZE = 10 * 1024 * 1024 * 1024  # 10 GB


class DownloadModelRequest(BaseModel):
    url: str
    filename: str


def _validate_download_request(url: str, filename: str) -> tuple[str, Path]:
    """Validate download URL and filename. Returns (url, safe_dest_path)."""
    from urllib.parse import urlparse

    # Validate URL domain
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(400, "Only HTTPS URLs are allowed")
    if parsed.hostname not in ALLOWED_DOWNLOAD_DOMAINS:
        raise HTTPException(
            400,
            f"Downloads only allowed from: {', '.join(ALLOWED_DOWNLOAD_DOMAINS)}"
        )

    # Sanitize filename — strip path components, enforce .gguf extension
    safe_name = Path(filename).name
    if not safe_name or not safe_name.endswith(".gguf"):
        raise HTTPException(400, "Filename must end with .gguf")
    if safe_name.startswith("."):
        raise HTTPException(400, "Invalid filename")

    dest = settings.models_dir / safe_name
    # Verify resolved path is inside models_dir
    if not dest.resolve().parent == settings.models_dir.resolve():
        raise HTTPException(400, "Invalid filename")

    return url, dest


@router.post("/api/setup/download-model")
async def download_model(body: DownloadModelRequest):
    """Download a model from an approved source with SSE progress streaming."""
    url, dest = _validate_download_request(body.url, body.filename)

    async def _download_stream():
        import hashlib
        import urllib.request

        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            yield {"event": "progress", "data": json.dumps({
                "event": "progress", "stage": "connecting", "percent": 0
            })}

            req = urllib.request.Request(url)
            req.add_header("User-Agent", "ProjectAlmanac/0.1")

            loop = asyncio.get_running_loop()

            def _do_download():
                response = urllib.request.urlopen(req, timeout=30)
                total = int(response.headers.get("Content-Length", 0))

                # Reject excessively large files
                if total > MAX_MODEL_SIZE:
                    raise ValueError(f"File too large: {total} bytes (max {MAX_MODEL_SIZE})")

                downloaded = 0
                sha256 = hashlib.sha256()
                chunk_size = 1024 * 1024  # 1MB chunks

                with open(str(dest), "wb") as f:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        sha256.update(chunk)
                        downloaded += len(chunk)
                        if downloaded > MAX_MODEL_SIZE:
                            raise ValueError("Download exceeded maximum size")

                return total, downloaded, sha256.hexdigest()

            total, downloaded, file_hash = await loop.run_in_executor(None, _do_download)

            # Log the hash for future pinning
            logger.info("Downloaded %s: %d bytes, SHA256=%s", dest.name, downloaded, file_hash)

            yield {"event": "progress", "data": json.dumps({
                "event": "progress", "stage": "complete",
                "percent": 100, "filename": dest.name,
                "size_mb": round(downloaded / (1024 * 1024), 1),
                "sha256": file_hash,
            })}

            yield {"event": "done", "data": json.dumps({
                "event": "done", "filename": dest.name,
            })}

        except Exception as e:
            logger.exception("Model download failed")
            # Clean up partial download
            if dest.exists():
                dest.unlink(missing_ok=True)
            yield {"event": "error", "data": json.dumps({
                "event": "error", "message": "Download failed. Please try again.",
            })}

    return EventSourceResponse(_download_stream(), media_type="text/event-stream")
