#!/usr/bin/env bash
#
# e2e_arena_flow.sh — End-to-end Arena scenario (plan unit W5.2).
#
# Proves the offline Arena pipeline as an executable scenario, from a clean
# temp store:
#
#   1. build the non-gui CLI (`npm run arenac:build`)
#   2. ingest a synthetic detailed GRE log via `watch-log`
#   3. `inspect-store` shows the match was projected
#   4. assert PLAY-LEVEL gameplay events were persisted (CARD_CAST / TURN_BEGIN
#      / LAND_PLAYED / …) — the parser produced typed gameplay events, not just
#      match summaries
#   5. `analyze-match <id>` emits findings JSON (a well-formed empty result is
#      acceptable when the synthetic game seeds no violation)
#
# No backend, no account, no network — fully offline. Exit 0 on success,
# non-zero with a clear message on failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE="crates/core-parser/tests/fixtures/gre/synthetic__full_game__mulligan_to_concession.log"
MATCH_ID="synthetic-match-0003"

# Gameplay ("play-level") event labels we require to have been ingested. These
# are core-domain EventType labels emitted only by the detailed GRE parser —
# their presence proves play-level parsing, not just match bookkeeping.
REQUIRED_LABELS=(CARD_CAST TURN_BEGIN LAND_PLAYED)

WORKDIR=""
cleanup() {
  if [[ -n "$WORKDIR" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== W5.2 Arena E2E flow =="
echo "repo root: $REPO_ROOT"

[[ -f "$FIXTURE" ]] || fail "synthetic GRE fixture not found: $FIXTURE"

echo "-- building CLI (npm run arenac:build) --"
npm run arenac:build >/dev/null 2>&1 || fail "npm run arenac:build failed"

BIN="$(find "$REPO_ROOT/target" -type f -name 'mancutg-arenac-cli' 2>/dev/null | head -1)"
[[ -n "$BIN" && -x "$BIN" ]] || fail "could not locate built mancutg-arenac-cli binary"
echo "cli: $BIN"

WORKDIR="$(mktemp -d)"
STORE="$WORKDIR/mancutg-arenac.sqlite"
echo "temp store: $STORE"

# 1) Ingest the synthetic detailed log into a clean store via watch-log.
echo "-- watch-log (ingest synthetic GRE log) --"
WATCH_JSON="$("$BIN" watch-log "$FIXTURE" "$STORE")" || fail "watch-log command failed"
INSERTED="$(printf '%s' "$WATCH_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["insertedEvents"])')" \
  || fail "could not parse watch-log output as JSON"
echo "inserted events: $INSERTED"
[[ "$INSERTED" -gt 0 ]] || fail "watch-log inserted no events"

# 2) inspect-store must show the match was projected from the log.
echo "-- inspect-store (match projection) --"
INSPECT_JSON="$("$BIN" inspect-store "$STORE")" || fail "inspect-store command failed"
printf '%s' "$INSPECT_JSON" | python3 -c '
import sys, json
d = json.load(sys.stdin)
match_ids = [m["match_id"] for m in d.get("matchHistory", [])]
want = "'"$MATCH_ID"'"
if want not in match_ids:
    print("expected match %r in inspect-store matchHistory, got %r" % (want, match_ids), file=sys.stderr)
    sys.exit(1)
if not d.get("sessions"):
    print("inspect-store reported no imported sessions", file=sys.stderr)
    sys.exit(1)
' || fail "inspect-store did not surface the expected match/session"
echo "match projected: $MATCH_ID"

# 3) Assert PLAY-LEVEL gameplay events were persisted. inspect-store's summary
#    intentionally carries only match/collection projections, so we read the
#    distinct event-type labels straight out of the local SQLite event store
#    (documented as SQLite-backed in CLAUDE.md) and grep for gameplay labels.
echo "-- assert play-level gameplay events present --"
LABELS="$(python3 -c '
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
for (label,) in con.execute("SELECT DISTINCT event_type FROM events ORDER BY event_type"):
    print(label)
' "$STORE")" || fail "could not read event labels from store"
echo "distinct event labels:"
printf '%s\n' "$LABELS" | sed 's/^/    /'
for label in "${REQUIRED_LABELS[@]}"; do
  printf '%s\n' "$LABELS" | grep -qx "$label" \
    || fail "expected play-level event label '$label' not found in store"
  echo "  found gameplay label: $label"
done

# 4) analyze-match must emit well-formed findings JSON (empty findings OK).
echo "-- analyze-match (findings JSON) --"
ANALYZE_JSON="$("$BIN" analyze-match "$MATCH_ID" "$STORE")" || fail "analyze-match command failed"
printf '%s' "$ANALYZE_JSON" | python3 -c '
import sys, json
d = json.load(sys.stdin)
want = "'"$MATCH_ID"'"
got = d.get("matchId")
if got != want:
    print("analyze-match matchId %r != %r" % (got, want), file=sys.stderr)
    sys.exit(1)
findings = d.get("findings")
if not isinstance(findings, list):
    print("analyze-match did not emit a findings array", file=sys.stderr)
    sys.exit(1)
print("findings: %d (cardDbAvailable=%s)" % (len(findings), d.get("cardDbAvailable")))
' || fail "analyze-match did not emit well-formed findings JSON"

echo
echo "PASS: Arena E2E flow (ingest -> inspect -> play-level events -> analyze-match)"
