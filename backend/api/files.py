from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.config import settings

logger = logging.getLogger("almanac.files")
router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"}


def _resolve_file(pack_id: str, filename: str) -> Path:
    """Resolve and validate a file path within content packs."""
    safe_filename = Path(filename).name
    if not safe_filename:
        raise HTTPException(400, "Invalid filename")

    suffix = Path(safe_filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type not allowed: {suffix}")

    # Search in both builtin and user content
    for base_dir in [settings.builtin_dir, settings.content_dir]:
        file_path = (base_dir / "packs" / pack_id / "files" / safe_filename).resolve()
        # Verify path stays inside the expected directory
        expected_parent = (base_dir / "packs" / pack_id / "files").resolve()
        if file_path.is_relative_to(expected_parent) and file_path.exists():
            return file_path

    raise HTTPException(404, "File not found")


@router.get("/api/files/{pack_id}/{filename}")
async def serve_file(pack_id: str, filename: str):
    """Serve a file from a content pack's files/ directory."""
    safe_pack_id = Path(pack_id).name  # Sanitize pack_id too
    file_path = _resolve_file(safe_pack_id, filename)

    media_types = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    media_type = media_types.get(file_path.suffix.lower(), "application/octet-stream")

    response = FileResponse(
        file_path,
        media_type=media_type,
    )
    # Display inline in browser (not download)
    response.headers["Content-Disposition"] = f'inline; filename="{file_path.name}"'
    return response


@router.get("/api/files")
async def list_files():
    """List all available files across content packs."""
    files = []
    for base_dir in [settings.builtin_dir, settings.content_dir]:
        packs_dir = base_dir / "packs"
        if not packs_dir.exists():
            continue
        for pack_dir in sorted(packs_dir.iterdir()):
            files_dir = pack_dir / "files"
            if not files_dir.exists():
                continue
            for f in sorted(files_dir.iterdir()):
                if f.suffix.lower() in ALLOWED_EXTENSIONS:
                    files.append({
                        "pack_id": pack_dir.name,
                        "filename": f.name,
                        "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
                        "url": f"/api/files/{pack_dir.name}/{f.name}",
                    })
    return files
