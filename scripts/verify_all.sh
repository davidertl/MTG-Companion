#!/usr/bin/env bash
# Full verification gate for MancuTG-Companion.
# Mirrors the CI job in .github/workflows/ci.yml so integration gates and
# local checks run the exact same chain with one command.
set -euo pipefail

cd "$(dirname "$0")/.."

npm test
npm run api:smoke
npm run arenac:build
npm run arenac:smoke
npm run paperc:build
