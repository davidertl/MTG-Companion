# MancuTG-Companion

Ein einheitliches, offline-taugliches Companion-Projekt fuer MTG Arena mit optionalem Backend fuer Sync, Aggregationen und plattformuebergreifende Erweiterungen.

## Einheitliche Produktterminologie

- **MancuTG-Companion** - Gesamtprojekt
- **MancuTG-backend** - Server / Backend-Service
- **MancuTG-ArenaC** - Desktop-App fuer MTG Arena
- **MancuTG-PaperC** - zukuenftige Papierkarten-Video-Tracking-App fuer Turniererfassung und Auswertung

## Produktthese

Bestehende Arena-Tracker loesen jeweils nur Teilprobleme gut:

- lokale Companion-Nutzung ohne Pflichtaccount
- Overlay/HUD waehrend des Spiels
- Match-History, Collection- und Economy-Tracking
- Draft-Werkzeuge und spaeter Replay-/Timeline-Funktionen
- optionale, nicht erzwungene Cloud-Synchronisation

Dieses Repository definiert die Zielarchitektur fuer eine neue App, die diese Faehigkeiten in einem Produkt zusammenfuehrt.

## Festgelegte Produktentscheidungen

- **Backend vorhanden, aber nicht verpflichtend:** MancuTG-ArenaC bleibt lokal nuetzlich, auch ohne Account oder laufenden MancuTG-backend.
- **Offline-first:** Parsing, lokaler Event-Store, Overlay, Match-History und Exporte funktionieren ohne Cloud.
- **Log-only Integration:** MTG Arena wird ausschliesslich ueber read-only Log Parsing angebunden.
- **Archidekt eingebunden:** Deck-Import und spaetere Sync-Flows werden ueber einen dedizierten Archidekt-Connector modelliert.
- **iOS/iPadOS ueber Offline-Import:** Exportierte MTG Arena iPhone/iPad-Logs koennen lokal importiert werden, ohne Live-Tracking auf dem Geraet.
- **Apache 2.0:** Neue Projektergebnisse in diesem Repo werden unter Apache-2.0 lizenziert.

## Dokumente

- `docs/architecture/unified-mtg-companion-architecture.md` - Produkt- und Zielarchitektur
- `docs/plans/2026-05-06-001-feat-unified-mtg-companion-platform-plan.md` - technische Umsetzungsplanung
- `docs/privacy/data-flow.md` - dokumentierter Datenfluss fuer Offline-, Sync-, Card-DB-, Analyse- und Referee-only-Pfade
- `docs/release/README.md` - Release-Hinweise fuer den aktuellen ArenaC-MVP-Stand
- `docs/release/mancutg-companion-1.0-checklist.md` - vollstaendige 1.0-Release-Checkliste (Arena- und Paper-Flow, Analyse, Referee-Mode, Card-DB, Sync)
- `docs/release/mancutg-arenac-mvp-checklist.md` - historische MancuTG-ArenaC-MVP-Checkliste
- `LICENSE` - Apache License 2.0

## Architektur in einem Satz

MancuTG-ArenaC ist ein lokaler Desktop-Client mit eigenem Event-Store; MancuTG-backend uebernimmt optional Sync, konto-basierte Mehrgeraete-Funktionen, aggregierte Analytics und Integrationen wie Archidekt, ohne den Kernnutzen des Clients davon abhaengig zu machen.

## Implementierter Stand

Das Repository enthaelt jetzt eine lauffaehige Grundimplementierung der Plattform:

- **Rust-Kernmodule**
  - `crates/core-domain` - gemeinsame Event- und Snapshot-Typen inkl. der typisierten Gameplay-Event-Vokabel (`GameAction`)
  - `crates/core-parser` - log-only Parser fuer normalisierte Events auf Play-Level (GRE-Gameplay: Casts, Zonenwechsel, Zuege/Phasen, Combat, Life) und Unknown-Event-Capture
  - `crates/core-store` - SQLite-basierter lokaler Event-Store und Projektionen
  - `crates/core-sync` - consent-gated Sync-Outbox (`sync_outbox`): Enqueue lokaler Events beim Ingest, Batch-Drain an das Backend `/events` mit `idempotencyKey`
  - `crates/core-carddb` - offline Kartenwissen: Streaming-Import der Scryfall-"Oracle Cards"-Bulk-Datei in ein lokales `cards.sqlite`; Lookup ueber `arena_id` und Kartenname; keine Runtime-Netzwerkaufrufe
  - `crates/core-gamestate` - deterministische Rekonstruktion: `GameTimeline::from_events` faltet Arena- oder Paper-Events zu per-Turn-`TurnSnapshot`s (Hidden Information ehrlich modelliert)
  - `crates/core-analysis` - reiner Regel-Checker + Heuristik-Engine: `analyze(timeline, carddb) -> Findings`; Findings tragen Severity, Confidence, CR-`ruleRefs` und ein `audience`-Feld; nie autonome Rulings
- **MancuTG-ArenaC-Kern**
  - `apps/desktop/src-tauri` - Offline-Bootstrap ueber Parser + Event-Store; kontinuierlicher Live-Watcher (`watch-log --follow`), `import-card-db`/`card-db-status`, `sync-now`, `analyze_match`-Kommando
  - `apps/desktop/src` - route-nahe Query-, Export-, Privacy-, Setup-, Deck-Cache- und Analyse-UI-Logik
  - `apps/desktop/src/app` und `apps/desktop/src/components` - navigierbare React-Application-Shell mit Match-Liste, per-Turn-Match-Detail, Timeline und Findings-/Suggestions-Ansicht
  - inklusive iOS/iPadOS-Offline-Importflow fuer `.log`-Dateien per Drag & Drop oder Ordnerimport
  - Live-Log-Watcher mit Checkpoints, Partial-Line-Buffering und Rotation-/Truncation-Erkennung
  - lokale Store-Summary, Import-Diagnostik, Reprocessing und Backup-Export auf Basis gespeicherter Raw Chunks
  - Privacy-/Settings-/Consent-Persistenz inkl. lokale Datenverwaltung und CLI-Steuerung
- **MancuTG-PaperC-App (lauffaehig)**
  - `apps/paperc/src` - Browser-PWA (Vite + React) zum move-by-move-Logging eines Papierspiels; jede Aktion wird ein `paperc.observation.detected`-Event mit typisiertem `gameActions`-Payload
  - `src/state` - append-only Game-Log mit Undo-als-Korrektur und lokaler Persistenz; `src/sync` - Offline-Outbox an `/events`
  - Referee-Feed/-View und Referee-only-Unterdrueckung im Player-Client
  - Start ueber `npm run paperc:dev`, statischer Bundle-Build ueber `npm run paperc:build` (`apps/paperc/dist`)
- **MancuTG-backend**
  - `services/api/src` - Node.js-Server mit SQLite-Persistenz (JSON-Store bleibt Kompatibilitaets-Fallback)
  - anonyme Routen (`/health`, `POST /events`, `GET /events?cursor=`, `/sync`, `/media/sessions`, Archidekt) bleiben ohne Account nutzbar
  - Auth/Rollen (`src/auth`): Bearer-Tokens + tournament-scoped Rollen (organizer/referee/player/spectator); Tournament-Routen erfordern Auth
  - Referee-only-Findings-Sichtbarkeit serverseitig erzwungen (`src/domain/findingsService.ts`, `GET /tournaments/:id/findings`): tabellengesteuerte `{mode x audience x role}`-Matrix, default-deny
  - `services/worker/src` - Hintergrundjob-Grundlage fuer serverseitige Verarbeitungsaufgaben
- **Archidekt-Connector fuer MancuTG-backend**
  - `services/archidekt-connector/src/connector.py` - read-only Import ueber `pyrchidekt`-kompatiblen Adapter
  - runtimefaehiger Python-Connector-Pfad fuer read-only Deckimporte inklusive Fehlerabbildung und Cache im Backend
- **Release-Haertung**
  - `scripts/arenac_smoke.sh` - build- und runtimebezogener CLI-Smoke-Test
  - `scripts/verify_all.sh` / `npm run verify:all` - vollstaendiges Gate: `npm test` + `api:smoke` + `arenac:build` + `arenac:smoke` + `paperc:build`
  - `docs/release/` - Release-Hinweise, 1.0-Checkliste und bekannte Grenzen des aktuellen Lieferpfads
- **Gemeinsame Vertrage**
  - `packages/shared-schema/src` - zod-validierte Schemas fuer Sync, Privacy, Sessions, Events, PaperC-Turnierkontext, Media-Ingest sowie `analysis` (Findings/Suggestions mit `audience`), `roles` und `gameActions`

## Repository-Struktur

```text
apps/
  desktop/
    src/
    src-tauri/
    tests/
crates/
  core-domain/
  core-parser/
  core-store/
  core-sync/
  core-carddb/
  core-gamestate/
  core-analysis/
packages/
  shared-schema/
services/
  api/
  archidekt-connector/
  worker/
```

## Lokale Checks

### Voraussetzungen

- Node.js 22+
- Rust 1.83+
- Python 3.12+

### Abhaengigkeiten installieren

```bash
npm install
```

### Gesamte Testkette

```bash
npm test
```

Das fuehrt aus:

- `npm run typecheck`
- `npm run test:ts`
- `npm run test:rust`
- `npm run test:python`

API-Smoke-Test separat:

```bash
npm run api:smoke
```

ArenaC-Build und CLI-Runtime-Smoke:

```bash
npm run arenac:build
npm run arenac:smoke
```

### Benutzbare Foundations-Einstiegspunkte

#### MancuTG-ArenaC als CLI

Usage anzeigen:

```bash
npm run desktop:help
```

Lokales Log bootstrapen:

```bash
cargo run -p mancutg-arenac -- bootstrap "/pfad/zur/Player.log"
```

Einzelne exportierte iOS-Logdatei importieren:

```bash
cargo run -p mancutg-arenac -- import-ios-file "/pfad/zur/exportierten.log" "/pfad/zur/mancutg-arenac.sqlite3"
```

Einen Ordner mit exportierten iOS-Logs importieren:

```bash
cargo run -p mancutg-arenac -- import-ios-folder "/pfad/zum/export-ordner" "/pfad/zur/mancutg-arenac.sqlite3"
```

Lokalen Store zusammenfassen:

```bash
cargo run -p mancutg-arenac -- inspect-store "/pfad/zur/mancutg-arenac.sqlite3"
```

Eine gespeicherte Session aus Raw Chunks erneut parsen:

```bash
cargo run -p mancutg-arenac -- reprocess-session "<session-id>" "/pfad/zur/mancutg-arenac.sqlite3"
```

Backup-Bundle aus dem lokalen Store exportieren:

```bash
cargo run -p mancutg-arenac -- export-backup "/pfad/zur/mancutg-arenac.sqlite3"
```

#### MancuTG-backend lokal starten

Den Foundations-API-Server lokal starten:

```bash
npm run api:start
```

Verfuegbare Endpunkte:

- `GET /health`
- `POST /events`
- `GET /events?cursor=<n>` - cursor-basierter Pull
- `POST /media/sessions`
- `POST /sync`
- `GET /integrations/archidekt/:deckId`

Auth- und Tournament-Routen (nur diese erfordern einen Bearer-Token; anonyme Routen bleiben ohne Account nutzbar):

- `POST /auth/register` (gated ueber `MANCUTG_ALLOW_REGISTRATION`)
- `POST /tournaments` - Ersteller wird organizer
- `POST /tournaments/:id/members` - Mitglied mit Rolle hinzufuegen
- `GET /tournaments/:id/role`
- `GET /tournaments/:id/findings` - Referee-only-Sichtbarkeit serverseitig erzwungen
- `POST /tournaments/:id/findings/:findingId/review`

Gemeinsamer Session-/Event-Batchvertrag fuer MancuTG-ArenaC, MancuTG-PaperC und backendseitige Prozesse:

```json
{
  "idempotencyKey": "push-001",
  "sessions": [
    {
      "sourceSessionId": "arena-session-1",
      "sourceApp": "mancutg-arenac",
      "sourceKind": "arena-log",
      "platform": "windows",
      "gameMode": "arena",
      "startedAt": "2026-05-06T22:39:00Z"
    }
  ],
  "events": [
    {
      "eventId": "unique-per-session",
      "sourceApp": "mancutg-arenac",
      "sourceSessionId": "arena-session-1",
      "eventType": "arena.match.completed",
      "occurredAt": "2026-05-06T22:40:00Z",
      "matchId": "match-1",
      "provenance": [
        {
          "sourceKind": "arena-log",
          "sourceSessionId": "arena-session-1"
        }
      ],
      "confidence": 1,
      "reviewStatus": "none",
      "payload": {
        "result": "win"
      }
    }
  ]
}
```

PaperC-spezifische Shared Contracts liegen jetzt in:

- `packages/shared-schema/src/paperc.ts`
- `packages/shared-schema/src/tournaments.ts`
- `packages/shared-schema/src/media.ts`

Die MancuTG-backend-Runtime speichert Session-/Event-/Media-Metadaten persistent. Der Store-Backend wird ueber den Pfad gewaehlt: Pfade mit `.json`-Endung (inkl. dem ungesetzten Default `./mancutg-backend-store.json`) nutzen den JSON-Store als Kompatibilitaets-Fallback; jeder andere Pfad oeffnet eine `node:sqlite`-Datenbank. Uebersteuerbar via:

```bash
# JSON-Kompatibilitaetspfad (Default)
MANCUTG_BACKEND_STORE_PATH=/pfad/zur/store-datei.json npm run api:start
# SQLite-Persistenz
MANCUTG_BACKEND_STORE_PATH=/pfad/zur/store-datei.sqlite npm run api:start
```

## Audit des aktuellen Zustands

### Bereits funktional

- Rust-Parser, lokaler SQLite-Store und Projektionen
- degradierbares MancuTG-ArenaC-Bootstrap aus lokalen Logs
- iOS/iPadOS-Offline-Import mit Deduplizierung und `ios`-Tagging
- TypeScript-Desktop-State fuer Setup, History, Collection, Draft, Privacy und Import-Center in MancuTG-ArenaC
- startbarer MancuTG-backend-Server fuer Health, gemeinsame Event-Ingestion, Sync und Archidekt-Import
- separater Media-Ingest-Pfad fuer MancuTG-PaperC ueber `POST /media/sessions`
- gemeinsame Session-/Event-Schnittstelle fuer MancuTG-ArenaC, MancuTG-PaperC und backendseitige Prozesse
- persistente Speicherung fuer Session-/Event-/Media-Metadaten im MancuTG-backend
- read-only Archidekt-Connector in Python
- Play-Level-GRE-Parsing, per-Turn-Rekonstruktion (`core-gamestate`) und lokale Analyse (`core-analysis`) mit Findings/Suggestions
- offline Card-DB-Import (`core-carddb`) aus Scryfall-Bulk-Daten ohne Runtime-Netzwerk
- consent-gated Sync-Outbox von ArenaC an das Backend
- lauffaehige MancuTG-PaperC-Move-Logging-PWA mit gemeinsamem Event-Envelope
- Backend-Auth/Rollen und serverseitig erzwungene Referee-only-Findings-Sichtbarkeit

### Noch nicht als vollstaendiges Produkt umgesetzt

- Overlay/HUD
- MancuTG-PaperC-Video-/Kamera-Pipeline (separater, spaeterer Track)
- Web-Profile, Sharing und Team-Funktionen
- gebuendeltes GUI-Installer-Paket (GTK/WebKit-Toolchain-Abhaengigkeit; CI baut den Rust-Kern und statische Bundles)

## Aktuelle Produktinvarianten

- MancuTG-ArenaC bleibt **ohne Account** und **ohne laufenden MancuTG-backend** lokal nutzbar.
- Arena wird ausschliesslich ueber **read-only Log Parsing** eingebunden.
- Sync, Telemetrie und Archidekt sind **optional** und durch Privacy-/Mode-Logik gated.
- iOS/iPadOS-Tracking ist **nur per Offline-Logimport** unterstuetzt; kein Live-Tracking, Overlay oder Sandbox-Zugriff auf dem Geraet.
- MancuTG-ArenaC unterstuetzt exportierte iOS-Logs per **Drag & Drop** und **Ordnerimport** mit Deduplizierung und `ios`-Plattformtagging.
- Der Exportweg fuer iOS-Logs setzt **nicht iTunes voraus**; Apple Devices (Windows), Finder (macOS) und notfalls Drittanbieter-Dateiwerkzeuge werden als Guidance modelliert.
- Archidekt ist in der ersten Stufe **read-only** und wird serverseitig ueber MancuTG-backend isoliert.
- Eine spaetere iOS-App wird nur als **Viewer/Sync/Import-Helper** betrachtet, nicht als Live-Tracker.
- MancuTG-PaperC ist die lauffaehige Move-Logging-App; die **Papierkarten-Video-/Kamera-Erfassung** bleibt ein separater, spaeterer Track.
- Die Analyse ist **human-in-the-loop**: sie erzeugt Findings (Severity, Confidence, CR-`ruleRefs`), aber **nie autonome Rulings**. Findings tragen ein `audience`-Feld; Referee-only-Findings werden **serverseitig** erzwungen und erreichen ausschliesslich Referee-/Organizer-Rollen, nie Spieler.
- Der Card-DB-Import laeuft **vollstaendig offline** aus einer manuell heruntergeladenen Scryfall-Bulk-Datei; **Raw-Log-Chunks werden nur bei explizitem `rawUpload`-Consent synchronisiert**.
- Neue Arbeit in diesem Repository bleibt **Apache-2.0-kompatibel**.
