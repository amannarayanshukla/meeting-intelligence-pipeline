#!/usr/bin/env bash
# One command to run the whole stack: builds the images, picks free host ports, waits until
# the API and UI answer, opens the UI in your browser, and tells you how to tail the worker logs.
#   git clone https://github.com/amannarayanshukla/meeting-intelligence-pipeline && cd meeting-intelligence-pipeline && ./demo.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (ships with Docker Desktop)."; exit 1; }

busy() { (command -v lsof >/dev/null && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1) || nc -z localhost "$1" >/dev/null 2>&1; }
pick() { local p=$1; while busy "$p"; do p=$((p + 1)); done; echo "$p"; }

export WEB_PORT=$(pick 3000)
export API_PORT=$(pick $((WEB_PORT + 1)))
export REDIS_PORT=$(pick 6379)
export MONGO_PORT=$(pick 27017)

echo "▶ building and starting (web :$WEB_PORT, api :$API_PORT, redis :$REDIS_PORT, mongo :$MONGO_PORT) …"
docker compose up --build -d

wait_for() { local url=$1 want=$2 n=0; until [ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" = "$want" ]; do n=$((n + 1)); [ $n -gt 90 ] && { echo "timed out waiting for $url"; docker compose logs --tail=30; exit 1; }; sleep 1; done; }
wait_for "http://localhost:$API_PORT/api/meetings/nope" 404
wait_for "http://localhost:$WEB_PORT/" 200

UI="http://localhost:$WEB_PORT"
cat <<MSG

✔ up.  UI  $UI
       API http://localhost:$API_PORT/api/meetings

Demo: click "Load sample" → "Process Pipeline" and watch the three cards land at ~1.5 s / 3 s / 4.5 s.
Split-screen the worker logs to see the three jobs start in the same second:
       docker compose logs -f api | grep -E '▶|✔'
Stop everything:
       docker compose down
MSG
if command -v open >/dev/null; then open "$UI"; elif command -v xdg-open >/dev/null; then xdg-open "$UI" >/dev/null 2>&1 || true; fi
