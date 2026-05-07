# MancuTG-ArenaC release notes

This directory collects release-facing documentation for the current ArenaC MVP track.

Current scope:

- reproducible local build for `mancutg-arenac`
- **Overwolf windowed MVP** (`apps/overwolf/`) plus **`mancutg-arenac serve`** loopback API
- CLI/runtime smoke coverage for the current ArenaC delivery path
- `npm run overwolf:smoke` for the HTTP service surface
- backend startup smoke coverage for MancuTG-backend
- install/run notes and known limitations (`overwolf-install.md`)

This is intentionally narrower than a fully bundled Tauri desktop release. The current branch hardens the ArenaC MVP around the Rust desktop core, local store workflows, the React shell (static tests + interactive client toolbar), the Overwolf-hosted UI on Windows, and the backend integration paths.
