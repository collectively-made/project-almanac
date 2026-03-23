# Design Note: Almanac as Knowledge Repository

**Date:** 2026-03-23

## Core Concept

Almanac is a **knowledge repository first, chat interface second.** The PDFs, guides, and manuals are the source of truth. The AI is an intelligent search and summarization layer. The chat gives quick answers, but the original documents are always accessible locally.

## Document References — Two Treatments

### 1. Inline References (AI-decided)

The AI chooses to call out a document in the response text when:
- It's leaning heavily on a single document
- The user would benefit from reading the full source (diagrams, detailed tables, step-by-step procedures)
- The answer is a summary that loses important nuance from the original

Example:
> "To safely can tomatoes, add 2 tablespoons of bottled lemon juice per quart. For complete processing times and altitude adjustments, see the **USDA Canning Guide — Tomatoes ↗**."

The inline reference renders as a small pill/badge with an arrow icon, linking to the locally stored PDF.

### 2. Bottom Sources (Always present)

The existing sources accordion lists everything that was retrieved. Documents that were referenced inline also appear here. Most sources won't be called out inline — they're just listed below for transparency.

### Key Rule

**The AI decides when an inline reference adds value.** We don't force it. The system prompt tells the model: "If you're drawing heavily from a specific document or think the user should read the full source, reference it by name. Otherwise, just answer — sources are shown automatically."

## Architecture

### Content Pack Format (Extended)

```
/app/content/packs/usda-canning/
    chunks/
        guide-3-tomatoes.jsonl     # RAG chunks
    files/
        GUIDE03_HomeCan_rev0715.pdf  # Full document
    manifest.json                   # Maps chunks → files
```

Each chunk tracks its source file:
```json
{
  "chunk_id": "fp_003",
  "text": "To can tomatoes safely...",
  "source": "USDA Complete Guide to Home Canning",
  "section": "Canning Tomatoes",
  "source_file": "GUIDE03_HomeCan_rev0715.pdf"
}
```

### Backend

- `GET /api/files/{pack_id}/{filename}` — serves PDFs from content packs (static file serving)
- RAG retrieval includes `source_file` in chunk metadata
- System prompt includes available document names/paths so the AI can reference them
- Documents served from local storage — works fully offline

### Frontend

**Sources accordion (bottom of response):**
```
[📄 📎] 3 sources · 1 document                    ▾
```
- Icon pill: overlapping page icon + clip icon (like TextQL)
- Badge counts on each
- "document" count only shows when local files are available
- Expanding shows source chunks + document links

**Inline reference (in response text):**
- Rendered as a small pill: `[Document Name ↗]`
- Clicking opens the PDF from local storage in a new tab
- The AI generates markdown like `[USDA Canning Guide ↗](/files/usda-canning/GUIDE03.pdf)`

### Online vs Offline Behavior

- **Always (offline-safe):** Local document links (PDFs stored in Almanac)
- **Only when online:** External reference URLs (if we add them later)
- **Never:** Redundant links to the same source the chunks already summarize, unless the AI decides the full document adds value

## Design Principle

**The documents are the product. The chat is how you access them.**

This positions Almanac as a local knowledge base with an AI interface — not a chatbot that happens to cite sources. The AI is a librarian that knows where everything is and can summarize it, but the full documents are always one click away.

## Implementation Priority

1. Add `files/` directory support to content packs
2. Backend static file serving endpoint
3. Add `source_file` field to chunk schema
4. Update system prompt to include available documents
5. Frontend: overlapping icon pill in sources accordion
6. Frontend: inline pill rendering for document links in markdown
7. Process USDA PDFs as both chunks AND stored files
8. Update content pipeline to preserve original PDFs alongside chunks
