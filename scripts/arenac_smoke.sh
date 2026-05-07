#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HELP_OUTPUT="$(cargo run -p mancutg-arenac -- --help)"
if [[ "$HELP_OUTPUT" != *"watch-log"* ]] || [[ "$HELP_OUTPUT" != *"export-backup"* ]]; then
  echo "ArenaC help output missing expected commands"
  exit 1
fi

LOG_PATH="$(mktemp --suffix=.log)"
STORE_PATH="$(mktemp --suffix=.sqlite3)"
SETTINGS_PATH="$(mktemp --suffix=.json)"

cleanup() {
  rm -f "$LOG_PATH" "$STORE_PATH" "$SETTINGS_PATH"
}
trap cleanup EXIT

cat > "$LOG_PATH" <<'EOF'
2026-05-07T04:00:00Z|MATCH_START|match_id=smoke-match|deck=Azorius Control|queue=ranked
2026-05-07T04:01:00Z|COLLECTION_SNAPSHOT|cards_owned=777
EOF

BOOTSTRAP_OUTPUT="$(cargo run -p mancutg-arenac -- bootstrap "$LOG_PATH")"
WATCH_OUTPUT="$(cargo run -p mancutg-arenac -- watch-log "$LOG_PATH" "$STORE_PATH")"
SETTINGS_OUTPUT="$(cargo run -p mancutg-arenac -- show-settings "$SETTINGS_PATH")"

python3 - "$BOOTSTRAP_OUTPUT" "$WATCH_OUTPUT" "$SETTINGS_OUTPUT" <<'PY'
import json
import sys

bootstrap = json.loads(sys.argv[1])
watch = json.loads(sys.argv[2])
settings = json.loads(sys.argv[3])

assert bootstrap["matchHistory"][0]["deck"] == "Azorius Control"
assert bootstrap["collectionSnapshot"]["cards_owned"] == 777
assert watch["insertedEvents"] >= 1
assert settings["privacy"]["telemetryEnabled"] is False
PY

echo "ArenaC smoke passed"
