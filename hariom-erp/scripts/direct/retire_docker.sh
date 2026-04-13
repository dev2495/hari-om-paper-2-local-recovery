#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
PURGE_IMAGES=0

for arg in "$@"; do
  case "$arg" in
    --purge-images) PURGE_IMAGES=1 ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--purge-images]"
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI not found. Nothing to retire."
  exit 0
fi

echo "[docker] stopping compose stack..."
docker compose -f "$COMPOSE_FILE" down

if [[ "$PURGE_IMAGES" -eq 1 ]]; then
  echo "[docker] removing compose images for this project..."
  docker compose -f "$COMPOSE_FILE" down --rmi local --volumes --remove-orphans
fi

echo "Docker stack retired. Use scripts/direct/start.sh for direct runtime."
