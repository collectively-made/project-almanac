# Project Almanac

An open-source, self-hosted survival knowledge platform. Dockerized, offline-first, with RAG-grounded AI responses you can actually trust.

## Quick Start

```bash
docker run -d \
  -p 8080:8080 \
  -v almanac-config:/app/config \
  -v almanac-models:/app/models \
  -v almanac-content:/app/content \
  ghcr.io/[org]/almanac:latest
```

Then open `http://localhost:8080`.

## Hardware Requirements

| Device | RAM | Experience |
|--------|-----|-----------|
| Raspberry Pi 5 | 8 GB | 3B model, ~5-10 tok/s |
| Synology NAS (J4125) | 8+ GB | 3B model, ~3-6 tok/s |
| UGREEN NAS (N-series) | 8-16 GB | 7B model, ~10-15 tok/s |
| Home server | 16+ GB | 7B-13B model, best experience |

**Minimum: 8 GB RAM.** The system will recommend an appropriate model for your hardware.

## Status

Under active development. Phase 1 (foundation + LLM inference) in progress.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
