# Project Almanac

An open-source, self-hosted survival knowledge platform. Offline-first AI grounded in real sources — USDA, FEMA, Extension Service publications.

**The problem:** Existing offline survival AI apps use small models with zero safety guardrails — a model can confidently misidentify a deadly mushroom as edible. Almanac treats accuracy as a life-safety engineering problem: every response is grounded in retrieved sources with confidence scoring.

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name almanac \
  -p 8080:8080 \
  -v almanac-config:/app/config \
  -v almanac-models:/app/models \
  -v almanac-content:/app/content \
  ghcr.io/collectively-made/project-almanac:latest
```

Open **http://localhost:8080**. The setup wizard will walk you through downloading a model — one button, no configuration needed.

### Docker Compose

```yaml
services:
  almanac:
    image: ghcr.io/collectively-made/project-almanac:latest
    ports:
      - "8080:8080"
    volumes:
      - almanac-config:/app/config
      - almanac-models:/app/models
      - almanac-content:/app/content
    restart: unless-stopped

volumes:
  almanac-config:
  almanac-models:
  almanac-content:
```

### Local Development

```bash
# Backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
pip install llama-cpp-python

mkdir -p data models content
ALMANAC_CONFIG_DIR=./data ALMANAC_MODELS_DIR=./models \
ALMANAC_CONTENT_DIR=./content ALMANAC_BUILTIN_DIR=./builtin \
  uvicorn backend.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173**. The app will guide you through model setup.

## How It Works

1. **Ask a question** about homesteading, food preservation, gardening, solar power, water systems, or construction
2. **RAG retrieval** searches the knowledge base using hybrid dense + keyword search
3. **AI generates a response** grounded in the retrieved sources
4. **Confidence scoring** shows how well-supported the answer is
5. **Source citations** let you verify the original material

All processing happens locally on your device. No cloud, no telemetry, no internet required after setup.

## Hardware Requirements

| Device | RAM | Model | Speed |
|--------|-----|-------|-------|
| Raspberry Pi 5 | 8 GB | 3B Q4 | ~5-10 tok/s |
| Synology NAS | 8+ GB | 3B Q4 | ~3-6 tok/s |
| UGREEN NAS | 8-16 GB | 3-7B Q4 | ~10-15 tok/s |
| Mac / PC | 16+ GB | 7B+ Q4 | ~30+ tok/s |

**Minimum: 8 GB RAM.** The setup wizard recommends the right model for your hardware.

## Adding Content

Place JSONL files in the content volume to add your own knowledge:

```
/app/content/packs/my-pack/
    topic.jsonl
```

Each line:
```json
{"chunk_id": "unique_id", "text": "Content...", "source": "Source Name", "section": "Section"}
```

Content is automatically indexed on restart. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `ALMANAC_PORT` | `8080` | Server port |
| `ALMANAC_MIN_RETRIEVAL_SCORE` | `0.3` | Confidence threshold |
| `PUID` / `PGID` | `1000` | File permission mapping |

## Security

- Runs as non-root user
- Read-only filesystem (production)
- All capabilities dropped
- No telemetry or external API calls
- Input validation and concurrency limits

## Architecture

Single Docker container: **FastAPI** + **React** + **sqlite-vec** (vector search) + **SQLite FTS5** (keyword search) + **llama-cpp-python** (local LLM) + **fastembed** (local embeddings). Hybrid retrieval with Reciprocal Rank Fusion.

## Roadmap

- [x] Phase 1-3: Foundation, RAG pipeline, polish
- [ ] Additional domains: wilderness survival, medical, disaster prep
- [ ] Content pack marketplace
- [ ] Native mobile app (React Native)
- [ ] Hardware products

## License

AGPL-3.0 — see [LICENSE](LICENSE).
