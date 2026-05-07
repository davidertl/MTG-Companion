# MancuTG-ArenaC MVP release checklist

## Build and runtime checks

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run api:smoke`
- [ ] `npm run arenac:build`
- [ ] `npm run overwolf:smoke`
- [ ] `npm run overwolf:build` (Overwolf-Bundle aus `apps/overwolf/`)
- [ ] `npm run arenac:smoke`

## Local ArenaC CLI checks

- [ ] `mancutg-arenac --help` shows `bootstrap`, `watch-log`, `inspect-store`, `reprocess-session`, `export-backup`
- [ ] `bootstrap` works against a representative local log file
- [ ] `watch-log` writes checkpoints and avoids duplicate events on restart
- [ ] `inspect-store` surfaces sessions, diagnostics, unknown events, and checkpoints
- [ ] `export-backup` produces a parseable backup bundle

## Overwolf + ArenaC sidecar (Windows MVP)

- [ ] `mancutg-arenac serve` erreichbar unter `http://127.0.0.1:17890` (oder Port aus `mancutg-arenac-service.json`)
- [ ] `GET /health` und `GET /v1/detect-player-log` liefern erwartete JSON-Struktur
- [ ] Overwolf-`manifest.json` laesst sich sideloaden; Setup-Fenster oeffnet Main-Fenster
- [ ] `docs/release/overwolf-install.md` entspricht dem tatsaechlichen Installationspfad

## Backend checks

- [ ] `npm run api:start` starts MancuTG-backend without extra manual setup
- [ ] `GET /health` returns `200`
- [ ] `POST /events` accepts the shared session/event batch structure
- [ ] `POST /media/sessions` accepts the PaperC media contract
- [ ] `GET /integrations/archidekt/:deckId` works with the runtime connector path or returns a clear error

## User-facing documentation

- [ ] README commands match actual runtime behavior
- [ ] local data paths are documented
- [ ] consent/settings behavior is documented
- [ ] iOS import path is documented
- [ ] Archidekt read-only limitation is documented

## Known limitations before a broader release

- No fully bundled Tauri desktop application package yet; Windows MVP ships as **Overwolf + sidecar** (`mancutg-arenac serve`) instead
- No full production MTGA parser coverage yet; current detailed-log support is a meaningful first step, not the final parser surface
- No multi-user auth backend
- No replay UI
- No ArenaC overlay/HUD
- No full PaperC product runtime
- No PaperC operator workbench yet (camera settings, zone calibration, player naming, live recognition/log view)
- PaperC is not part of the Overwolf deployment path; it targets a standalone Windows webcam setup
