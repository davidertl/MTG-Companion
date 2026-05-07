# Demo Checklist

## ArenaC

- [ ] npm ci successful
- [ ] npm ci --prefix apps/overwolf successful
- [ ] npm run typecheck successful
- [ ] npm run overwolf:build successful
- [ ] OPK generated
- [ ] Manifest contains icons
- [ ] MTGA path resolves to Wizards Of The Coast/MTGA/player.log
- [ ] Setup window opens main window via restore
- [ ] Sidecar health check works
- [ ] ArenaC can send one event batch to backend

Evidence pointers:

- `npm ci successful` -> `npm ci`
- `npm ci --prefix apps/overwolf successful` -> `npm ci --prefix apps/overwolf`
- `npm run typecheck successful` -> `npm run typecheck`
- `npm run overwolf:build successful` -> `npm run build --prefix apps/overwolf`
- `OPK generated` -> `pwsh scripts/package-overwolf.ps1`
- `Manifest contains icons` -> [`apps/overwolf/public/manifest.json`](apps/overwolf/public/manifest.json)
- `MTGA path resolves to Wizards Of The Coast/MTGA/player.log` -> [`apps/desktop/src-tauri/src/serve.rs`](apps/desktop/src-tauri/src/serve.rs)
- `Setup window opens main window via restore` -> [`apps/overwolf/tests/setup-window.spec.tsx`](apps/overwolf/tests/setup-window.spec.tsx)
- `Sidecar health check works` -> [`apps/overwolf/tests/sidecar-ensure-running.spec.ts`](apps/overwolf/tests/sidecar-ensure-running.spec.ts)
- `ArenaC can send one event batch to backend` -> [`apps/overwolf/tests/producer-config.spec.ts`](apps/overwolf/tests/producer-config.spec.ts)

## PaperC

- [ ] PaperC standalone app starts
- [ ] New paper session can be created
- [ ] Detection tick creates event
- [ ] Running mode creates repeated events
- [ ] JSONL export works
- [ ] Backend sync checks HTTP status
- [ ] Failed backend sync remains visible/retryable
- [ ] Review event path exists for low confidence

Evidence pointers:

- `PaperC standalone app starts` -> `npm run build --prefix apps/paperc-desktop`
- `New paper session can be created` -> [`apps/paperc/tests/paperc-desktop-smoke.spec.tsx`](apps/paperc/tests/paperc-desktop-smoke.spec.tsx)
- `Detection tick creates event` -> [`apps/paperc/tests/runtime-pipeline.spec.ts`](apps/paperc/tests/runtime-pipeline.spec.ts)
- `Running mode creates repeated events` -> [`apps/paperc/tests/runtime-live-loop.spec.ts`](apps/paperc/tests/runtime-live-loop.spec.ts)
- `JSONL export works` -> [`apps/paperc/tests/jsonl-log-writer.spec.ts`](apps/paperc/tests/jsonl-log-writer.spec.ts)
- `Backend sync checks HTTP status` -> [`apps/paperc/tests/backend-forwarding.spec.ts`](apps/paperc/tests/backend-forwarding.spec.ts)
- `Failed backend sync remains visible/retryable` -> [`apps/paperc/tests/backend-forwarding.spec.ts`](apps/paperc/tests/backend-forwarding.spec.ts)
- `Review event path exists for low confidence` -> [`apps/paperc/tests/review-flow.spec.ts`](apps/paperc/tests/review-flow.spec.ts)

## Backend/WebUI

- [ ] POST /v1/ingest/batches accepts ArenaC batch
- [ ] POST /v1/ingest/batches accepts PaperC batch
- [ ] Duplicate batch is deduped
- [ ] GET /v1/sessions lists sessions
- [ ] GET /v1/sessions/:id/events lists events
- [ ] WebUI dashboard shows sessions and latest events
- [ ] CORS is not wildcard outside dev mode

Evidence pointers:

- `POST /v1/ingest/batches accepts ArenaC batch` -> [`services/api/tests/ingest-batches.spec.ts`](services/api/tests/ingest-batches.spec.ts)
- `POST /v1/ingest/batches accepts PaperC batch` -> [`services/api/tests/ingest-batches.spec.ts`](services/api/tests/ingest-batches.spec.ts)
- `Duplicate batch is deduped` -> [`services/api/tests/ingest-batches.spec.ts`](services/api/tests/ingest-batches.spec.ts)
- `GET /v1/sessions lists sessions` -> [`services/api/tests/read-api.spec.ts`](services/api/tests/read-api.spec.ts)
- `GET /v1/sessions/:id/events lists events` -> [`services/api/tests/read-api.spec.ts`](services/api/tests/read-api.spec.ts)
- `WebUI dashboard shows sessions and latest events` -> [`services/web/tests/dashboard-flow.spec.tsx`](services/web/tests/dashboard-flow.spec.tsx)
- `CORS is not wildcard outside dev mode` -> [`services/api/tests/server.spec.ts`](services/api/tests/server.spec.ts)

## Windows Manual Flow

- Install the generated `.opk` from `dist/` after running `pwsh scripts/package-overwolf.ps1`.
- Launch MTG Arena, then confirm Overwolf launches ArenaC setup and main windows.
- Verify sidecar health at `http://127.0.0.1:17890/health` and confirm setup reports clear status/errors.
- Start a PaperC session, produce events, export `.jsonl`, and validate retry behavior on temporary backend failure.
- Open WebUI (`services/web`) and confirm dashboard/session pages show newly ingested ArenaC and PaperC events.
