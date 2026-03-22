#!/bin/bash
set -e

# PUID/PGID mapping (LinuxServer.io convention)
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Update almanac user UID/GID if different from default
if [ "$(id -u almanac)" != "$PUID" ]; then
    usermod -o -u "$PUID" almanac 2>/dev/null || true
fi
if [ "$(id -g almanac)" != "$PGID" ]; then
    groupmod -o -g "$PGID" almanac 2>/dev/null || true
fi

# Ensure volume directories are owned by the correct user
chown -R almanac:almanac /app/config /app/models /app/content 2>/dev/null || true

# Graceful shutdown handler
shutdown() {
    echo '{"timestamp":"'$(date -Iseconds)'","level":"info","event":"shutdown_signal_received"}'
    # uvicorn handles SIGTERM gracefully — just forward it
    kill -TERM "$PID" 2>/dev/null
    wait "$PID"
    echo '{"timestamp":"'$(date -Iseconds)'","level":"info","event":"shutdown_complete"}'
    exit 0
}

trap shutdown SIGTERM SIGINT

# Run as the almanac user
exec gosu almanac "$@" &
PID=$!
wait "$PID"
