# ============================================================
# Stage 1: Build React frontend
# ============================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# ============================================================
# Stage 2: Python runtime
# ============================================================
FROM python:3.12-slim-bookworm AS runtime

# System deps for llama-cpp-python compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake g++ libopenblas-dev gosu \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash almanac

WORKDIR /app

# Python deps (cached layer)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist ./static/

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create volume mount points
RUN mkdir -p /app/config /app/models /app/content /app/builtin && \
    chown -R almanac:almanac /app

# Environment defaults
ENV ALMANAC_CONFIG_DIR=/app/config \
    ALMANAC_MODELS_DIR=/app/models \
    ALMANAC_CONTENT_DIR=/app/content \
    ALMANAC_BUILTIN_DIR=/app/builtin \
    PUID=1000 \
    PGID=1000

EXPOSE 8080

# Health check — uses python, no curl needed
# start-period=120s allows time for content indexing on Pi
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
