from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.dependencies import get_llm_manager, get_vectorstore
from backend.llm.manager import LLMManager, _get_available_ram_gb
from backend.rag.vectorstore import VectorStore

logger = logging.getLogger("almanac.setup")
router = APIRouter()

# Recommended models manifest — SHA256 pinned to specific HuggingFace files
RECOMMENDED_MODELS = [
    {
        "name": "Phi-3-mini-4k-instruct-q4.gguf",
        "description": "Microsoft Phi-3 Mini (3.8B) — best for 8GB devices",
        "size_gb": 2.2,
        "min_ram_gb": 6,
        "parameters": "3.8B",
        "quantization": "Q4_K_M",
        "url": "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf",
        "sha256": None,  # Will be populated when we pin a specific revision
    },
    {
        "name": "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        "description": "Qwen 2.5 (3B) — good quality, small footprint",
        "size_gb": 1.8,
        "min_ram_gb": 6,
        "parameters": "3B",
        "quantization": "Q4_K_M",
        "url": "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
        "sha256": None,
    },
]


@router.get("/api/setup/status")
async def setup_status(
    llm: LLMManager = Depends(get_llm_manager),
    vectorstore: VectorStore = Depends(get_vectorstore),
):
    """Check if the system needs initial setup."""
    models = llm.list_models()
    has_model = len(models) > 0
    model_loaded = llm.is_loaded
    chunks = vectorstore.count_chunks()
    ram_gb = _get_available_ram_gb()

    if not has_model:
        status = "needs_model"
    elif not model_loaded:
        status = "model_available"
    else:
        status = "ready"

    # Filter recommended models by hardware
    suitable_models = [
        m for m in RECOMMENDED_MODELS if m["min_ram_gb"] <= ram_gb
    ]

    return {
        "status": status,
        "has_model": has_model,
        "model_loaded": model_loaded,
        "available_models": models,
        "indexed_chunks": chunks,
        "hardware": {
            "ram_gb": round(ram_gb, 1),
            "cpu_count": __import__("os").cpu_count(),
        },
        "recommended_models": suitable_models,
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
