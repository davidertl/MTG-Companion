# MancuTG-ArenaC release notes

This directory collects release-facing documentation for the current ArenaC MVP track.

Current scope:

- reproducible local build for `mancutg-arenac`
- **Overwolf windowed MVP** (`apps/overwolf/`) plus **`mancutg-arenac serve`** loopback API
- CLI/runtime smoke coverage for the current ArenaC delivery path
- `npm run overwolf:smoke` for the HTTP service surface
- backend startup smoke coverage for MancuTG-backend
- install/run notes and known limitations (`overwolf-install.md`)
- Game-ID verification gate (`overwolf-gameid-verification.md`)
- Integrated deadline gate checklist (`../../DEMO_CHECKLIST.md`)

This is intentionally narrower than a fully bundled Tauri desktop release. The current branch hardens the ArenaC MVP around the Rust desktop core, local store workflows, the React shell (static tests + interactive client toolbar), the Overwolf-hosted UI on Windows, and the backend integration paths.

## PaperC baseline for upcoming delivery

- Shared PaperC schemas/contracts are available and backend ingest accepts PaperC event/media payloads.
- PaperC runtime recognition is not yet production-ready: OCR/CV inference, zone calibration UX, and live operator workbench are in active development.
- Next PaperC release target is a webcam-first operator flow with settings, player naming, zone setup, recognition overview, and live game log output.
- PaperC deployment target is Windows notebooks/desktops with attached webcam and standalone desktop UI, separate from Overwolf.
