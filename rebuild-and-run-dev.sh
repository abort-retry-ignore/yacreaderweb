#!/usr/bin/env bash
set -euo pipefail

docker rm -f YACReaderWebreader >/dev/null 2>&1 || true
docker compose -f docker-compose-dev.yaml up --build -d
