#!/usr/bin/env bash
#
# e2e_paper_referee_flow.sh — End-to-end paper/referee visibility scenario
# (plan unit W5.2). This encodes the RELEASE-BLOCKING assertion: a
# `referee-only` finding must reach referees but NEVER a player.
#
# Flow, from a clean temp backend store:
#
#   1. start the backend (node --experimental-strip-types) with a temp store and
#      MANCUTG_ALLOW_REGISTRATION=1; wait for /health; kill it on exit
#   2. register organizer + referee + player (capture bearer tokens + userIds)
#   3. organizer creates a tournament with findingVisibilityMode=referee-only
#   4. organizer adds the referee and player as members
#   5. POST an `analysis.finding.raised` event (audience referee-only, scoped to
#      the tournament) via /events
#   6. GET /tournaments/:id/findings as REFEREE  -> the finding IS present
#      GET /tournaments/:id/findings as PLAYER   -> 200 AND the finding ABSENT
#
# Step 6's player check is the release-blocking assertion: any leak fails hard.
# Uses curl + python3 (jq may be absent). Exit 0 on success, non-zero on failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FINDING_ID="finding-referee-only-1"
GAME_KEY="paper-game-ref-1"

WORKDIR=""
BACKEND_PID=""
cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$WORKDIR" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== W5.2 Paper/referee visibility E2E flow =="
echo "repo root: $REPO_ROOT"

WORKDIR="$(mktemp -d)"
STORE_JSON="$WORKDIR/mancutg-backend-store.json"
BACKEND_LOG="$WORKDIR/backend.log"

PORT="$(python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()')" || fail "could not pick a free port"
BASE="http://127.0.0.1:$PORT"
echo "backend base: $BASE"
echo "backend store: $STORE_JSON"

# 1) Start the backend with a temp store + registration enabled.
echo "-- starting backend --"
PORT="$PORT" \
  MANCUTG_BACKEND_STORE_PATH="$STORE_JSON" \
  MANCUTG_ALLOW_REGISTRATION=1 \
  node --experimental-strip-types services/api/src/main.ts >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Robust wait for /health.
HEALTHY=0
for _ in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "--- backend log ---" >&2
    cat "$BACKEND_LOG" >&2 || true
    fail "backend process exited before becoming healthy"
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    HEALTHY=1
    break
  fi
  sleep 0.25
done
[[ "$HEALTHY" == "1" ]] || { cat "$BACKEND_LOG" >&2 || true; fail "backend did not become healthy"; }
echo "backend healthy (pid $BACKEND_PID)"

# --- curl helper: prints response body, then a final line with HTTP status. ---
api() {
  # usage: api METHOD PATH [TOKEN] [BODY]
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local -a args=(-sS -X "$method" "$BASE$path" -H 'Content-Type: application/json' -w $'\n%{http_code}')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}"
}

status_of() { printf '%s' "$1" | tail -n1; }
body_of()   { printf '%s' "$1" | sed '$d'; }

json_get() {
  # json_get <json> <python-expr over variable d> -> prints result
  printf '%s' "$1" | python3 -c 'import sys, json
d = json.load(sys.stdin)
print(eval(sys.argv[1]))' "$2"
}

register() {
  # register <displayName> -> "userId token"
  local name="$1"
  local resp status
  resp="$(api POST /auth/register "" "{\"displayName\":\"$name\"}")"
  status="$(status_of "$resp")"
  [[ "$status" == "201" ]] || fail "register $name expected 201, got $status"
  json_get "$(body_of "$resp")" 'd["userId"] + " " + d["token"]'
}

# 2) Register the three actors.
echo "-- registering organizer / referee / player --"
read -r ORG_ID   ORG_TOKEN    < <(register Organizer)
read -r REF_ID   REF_TOKEN    < <(register Referee)
read -r PLAYER_ID PLAYER_TOKEN < <(register Player)
echo "organizer=$ORG_ID referee=$REF_ID player=$PLAYER_ID"

# 3) Organizer creates a referee-only tournament.
echo "-- creating referee-only tournament --"
CREATE_RESP="$(api POST /tournaments "$ORG_TOKEN" \
  '{"name":"W5.2 Referee E2E","settings":{"findingVisibilityMode":"referee-only"}}')"
[[ "$(status_of "$CREATE_RESP")" == "201" ]] || fail "create tournament expected 201, got $(status_of "$CREATE_RESP")"
TOURNAMENT_ID="$(json_get "$(body_of "$CREATE_RESP")" 'd["tournament"]["tournamentId"]')"
MODE="$(json_get "$(body_of "$CREATE_RESP")" 'd["tournament"]["settings"]["findingVisibilityMode"]')"
[[ "$MODE" == "referee-only" ]] || fail "tournament mode expected referee-only, got $MODE"
echo "tournament: $TOURNAMENT_ID (mode=$MODE)"

# 4) Add referee + player members (organizer-only mutation).
echo "-- adding members --"
ADD_REF="$(api POST "/tournaments/$TOURNAMENT_ID/members" "$ORG_TOKEN" \
  "{\"userId\":\"$REF_ID\",\"role\":\"referee\"}")"
[[ "$(status_of "$ADD_REF")" == "201" ]] || fail "add referee expected 201, got $(status_of "$ADD_REF")"
ADD_PLAYER="$(api POST "/tournaments/$TOURNAMENT_ID/members" "$ORG_TOKEN" \
  "{\"userId\":\"$PLAYER_ID\",\"role\":\"player\"}")"
[[ "$(status_of "$ADD_PLAYER")" == "201" ]] || fail "add player expected 201, got $(status_of "$ADD_PLAYER")"
echo "referee + player added"

# 5) POST an analysis.finding.raised event (audience referee-only) into the
#    tournament. The finding is scoped by tournamentId in the payload; the event
#    rides the ordinary /events envelope with its registering session.
echo "-- posting referee-only finding via /events --"
EVENT_BODY="$(python3 - "$TOURNAMENT_ID" "$FINDING_ID" "$GAME_KEY" <<'PY'
import sys, json
tid, finding_id, game_key = sys.argv[1], sys.argv[2], sys.argv[3]
batch = {
    "sessions": [
        {
            "sourceSessionId": "paper-ref-session-1",
            "sourceApp": "mancutg-arenac",
            "sourceKind": "manual-entry",
            "platform": "paper",
            "gameMode": "paper",
            "startedAt": "2026-07-06T17:00:00Z",
        }
    ],
    "events": [
        {
            "eventId": finding_id,
            "sourceApp": "mancutg-arenac",
            "sourceSessionId": "paper-ref-session-1",
            "eventType": "analysis.finding.raised",
            "occurredAt": "2026-07-06T17:00:05Z",
            "provenance": [
                {"sourceKind": "manual-entry", "sourceSessionId": "paper-ref-session-1"}
            ],
            "payload": {
                "tournamentId": tid,
                "findingId": finding_id,
                "gameKey": game_key,
                "turnNumber": 3,
                "phase": "combat",
                "kind": "rule-check",
                "code": "illegal-attack",
                "severity": "possible-violation",
                "confidence": 0.9,
                "ruleRefs": ["CR 508.1a"],
                "description": "Attacker declared while tapped (seeded violation).",
                "audience": "referee-only",
                "engineVersion": "e2e-test-1.0",
            },
        }
    ],
}
print(json.dumps(batch))
PY
)"
POST_EVENT="$(api POST /events "" "$EVENT_BODY")"
[[ "$(status_of "$POST_EVENT")" == "200" ]] || { echo "$(body_of "$POST_EVENT")" >&2; fail "POST /events expected 200, got $(status_of "$POST_EVENT")"; }
ACCEPTED="$(json_get "$(body_of "$POST_EVENT")" 'd["acceptedEventCount"]')"
[[ "$ACCEPTED" == "1" ]] || fail "POST /events accepted $ACCEPTED events, expected 1"
echo "finding event accepted"

# 6a) Referee feed MUST contain the finding.
echo "-- referee findings feed (must contain finding) --"
REF_FEED="$(api GET "/tournaments/$TOURNAMENT_ID/findings" "$REF_TOKEN")"
[[ "$(status_of "$REF_FEED")" == "200" ]] || fail "referee findings GET expected 200, got $(status_of "$REF_FEED")"
printf '%s' "$(body_of "$REF_FEED")" | python3 -c '
import sys, json
d = json.load(sys.stdin)
want = "'"$FINDING_ID"'"
ids = [f["finding"]["findingId"] for f in d.get("findings", [])]
if d.get("findingVisibilityMode") != "referee-only":
    print("referee feed mode %r != referee-only" % d.get("findingVisibilityMode"), file=sys.stderr)
    sys.exit(1)
if want not in ids:
    print("RELEASE-BLOCKING: referee cannot see referee-only finding %r; got %r" % (want, ids), file=sys.stderr)
    sys.exit(1)
print("referee sees finding %s (feed size %d)" % (want, len(ids)))
' || fail "referee did not see the referee-only finding"

# 6b) RELEASE-BLOCKING: player feed must be 200 AND must NOT contain the finding.
echo "-- player findings feed (RELEASE-BLOCKING: must NOT contain finding) --"
PLAYER_FEED="$(api GET "/tournaments/$TOURNAMENT_ID/findings" "$PLAYER_TOKEN")"
PLAYER_STATUS="$(status_of "$PLAYER_FEED")"
[[ "$PLAYER_STATUS" == "200" ]] || fail "player findings GET expected 200 (presence must not leak via status), got $PLAYER_STATUS"
printf '%s' "$(body_of "$PLAYER_FEED")" | python3 -c '
import sys, json
d = json.load(sys.stdin)
want = "'"$FINDING_ID"'"
ids = [f["finding"]["findingId"] for f in d.get("findings", [])]
if want in ids:
    print("RELEASE-BLOCKING FAILURE: referee-only finding %r LEAKED to player; feed=%r" % (want, ids), file=sys.stderr)
    sys.exit(1)
print("player feed clean (visible findings: %d)" % len(ids))
' || fail "referee-only finding leaked to player (RELEASE-BLOCKING)"

echo
echo "PASS: Paper/referee visibility E2E flow"
echo "      referee-only finding visible to referee, absent from player (release-blocking check green)"
