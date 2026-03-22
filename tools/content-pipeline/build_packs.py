#!/usr/bin/env python3
"""Build content packs from raw source materials.

Usage:
    python tools/content-pipeline/build_packs.py

Converts markdown files in tools/content-pipeline/sources/ into
JSONL content packs in builtin/packs/.
"""
import hashlib
import json
import re
from pathlib import Path


SOURCES_DIR = Path(__file__).parent / "sources"
OUTPUT_DIR = Path(__file__).parent / "../../builtin/packs"


def chunk_markdown(text: str, source: str, max_tokens: int = 800) -> list[dict]:
    """Split markdown into chunks by heading, keeping sections together."""
    chunks = []
    current_section = ""
    current_text = ""
    heading_stack: list[str] = []

    for line in text.split("\n"):
        heading_match = re.match(r"^(#{1,3})\s+(.+)", line)

        if heading_match:
            # Save previous chunk if substantial
            if current_text.strip() and len(current_text.strip()) > 50:
                breadcrumb = " > ".join(heading_stack) if heading_stack else current_section
                chunks.append({
                    "text": current_text.strip(),
                    "section": breadcrumb,
                })

            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            current_section = title

            # Update heading stack
            while len(heading_stack) >= level:
                heading_stack.pop()
            heading_stack.append(title)

            current_text = ""
        else:
            current_text += line + "\n"

    # Don't forget the last chunk
    if current_text.strip() and len(current_text.strip()) > 50:
        breadcrumb = " > ".join(heading_stack) if heading_stack else current_section
        chunks.append({
            "text": current_text.strip(),
            "section": breadcrumb,
        })

    # Add metadata
    result = []
    for i, chunk in enumerate(chunks):
        chunk_id = hashlib.md5(f"{source}:{chunk['section']}:{i}".encode()).hexdigest()[:12]
        result.append({
            "chunk_id": f"{chunk_id}",
            "text": chunk["text"],
            "source": source,
            "section": chunk["section"],
            "safety_tier": "guarded",
        })

    return result


def build_pack(pack_name: str, source_dir: Path) -> int:
    """Build a content pack from a directory of markdown files."""
    output_dir = OUTPUT_DIR / pack_name
    output_dir.mkdir(parents=True, exist_ok=True)

    all_chunks = []
    for md_file in sorted(source_dir.glob("*.md")):
        source_name = md_file.stem.replace("-", " ").replace("_", " ").title()
        text = md_file.read_text()
        chunks = chunk_markdown(text, source=source_name)
        all_chunks.extend(chunks)
        print(f"  {md_file.name}: {len(chunks)} chunks")

    # Write as JSONL (one file per pack for simplicity)
    jsonl_path = output_dir / f"{pack_name}.jsonl"
    with open(jsonl_path, "w") as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk) + "\n")

    print(f"  Total: {len(all_chunks)} chunks -> {jsonl_path}")
    return len(all_chunks)


def main():
    if not SOURCES_DIR.exists():
        print(f"Sources directory not found: {SOURCES_DIR}")
        print("Create markdown files in tools/content-pipeline/sources/<pack-name>/")
        return

    total = 0
    for pack_dir in sorted(SOURCES_DIR.iterdir()):
        if pack_dir.is_dir() and list(pack_dir.glob("*.md")):
            print(f"\nBuilding pack: {pack_dir.name}")
            count = build_pack(pack_dir.name, pack_dir)
            total += count

    print(f"\n=== Built {total} total chunks ===")


if __name__ == "__main__":
    main()
