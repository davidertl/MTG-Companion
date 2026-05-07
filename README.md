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
- `docs/privacy/data-flow.md` - dokumentierter Datenfluss fuer Offline-, Sync- und Telemetriepfade
- `docs/release/README.md` - Release-Hinweise fuer den aktuellen ArenaC-MVP-Stand
- `docs/release/mancutg-arenac-mvp-checklist.md` - konkrete Release-Checkliste fuer MancuTG-ArenaC
- `LICENSE` - Apache License 2.0

## Architektur in einem Satz

MancuTG-ArenaC ist ein lokaler Desktop-Client mit eigenem Event-Store; MancuTG-backend uebernimmt optional Sync, konto-basierte Mehrgeraete-Funktionen, aggregierte Analytics und Integrationen wie Archidekt, ohne den Kernnutzen des Clients davon abhaengig zu machen.

## Implementierter Stand

Das Repository enthaelt jetzt eine lauffaehige Grundimplementierung der Plattform:

- **Rust-Kernmodule**
  - `crates/core-domain` - gemeinsame Event- und Snapshot-Typen
  - `crates/core-parser` - log-only Parser fuer normalisierte Events und Unknown-Event-Capture
  - `crates/core-store` - SQLite-basierter lokaler Event-Store und Projektionen
  - `crates/core-sync` - Outbox-/Sync-Objekte fuer optionale Backend-Synchronisation
- **MancuTG-ArenaC-Kern**
  - `apps/desktop/src-tauri` - Offline-Bootstrap ueber Parser + Event-Store
  - `apps/desktop/src` - route-nahe Query-, Export-, Privacy-, Setup- und Deck-Cache-Logik
  - `apps/desktop/src/app` und `apps/desktop/src/components` - React-basierte Application Shell auf Basis der vorhandenen ArenaC-Viewmodels
  - inklusive iOS/iPadOS-Offline-Importflow fuer `.log`-Dateien per Drag & Drop oder Ordnerimport
  - Live-Log-Watcher mit Checkpoints, Partial-Line-Buffering und Rotation-/Truncation-Erkennung
  - lokale Store-Summary, Import-Diagnostik, Reprocessing und Backup-Export auf Basis gespeicherter Raw Chunks
  - Privacy-/Settings-/Consent-Persistenz inkl. lokale Datenverwaltung und CLI-Steuerung
- **MancuTG-backend-Grundlage**
  - `services/api/src` - optionale Sync-, Auth-, Archidekt-Import- und Telemetry-Services
  - `services/worker/src` - Hintergrundjob-Grundlage fuer serverseitige Verarbeitungsaufgaben
  - persistente JSON-Speicherung fuer Session-/Event-/Media-Metadaten im Runtime-Server
- **Minimales MancuTG-PaperC-Skeleton**
  - `apps/paperc/src` - Contract-/Capture-/Event-/Tournament-Builder zur Validierung der Shared Contracts
- **Erster ArenaC-Detailed-Log-Schritt**
  - `crates/core-parser` versteht jetzt neben dem Demoformat auch MTGA-like JSON-Logfragmente mit Golden-Test-Fixture
- **Archidekt-Connector fuer MancuTG-backend**
  - `services/archidekt-connector/src/connector.py` - read-only Import ueber `pyrchidekt`-kompatiblen Adapter
  - runtimefaehiger Python-Connector-Pfad fuer read-only Deckimporte inklusive Fehlerabbildung und Cache im Backend
- **ArenaC MVP-Release-Haertung**
  - `scripts/arenac_smoke.sh` - build- und runtimebezogener CLI-Smoke-Test
  - `docs/release/` - Release-Hinweise, MVP-Checkliste und bekannte Grenzen des aktuellen Lieferpfads
- **Gemeinsame Vertrage**
  - `packages/shared-schema/src` - zod-validierte Schemas fuer Sync, Privacy, Sessions, Events, PaperC-Turnierkontext und Media-Ingest

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
- `POST /media/sessions`
- `POST /sync`
- `GET /integrations/archidekt/:deckId`

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

Die MancuTG-backend-Runtime speichert Session-/Event-/Media-Metadaten persistent in einer JSON-Datei. Standardpfad:

```text
./mancutg-backend-store.json
```

Uebersteuerbar via:

```bash
MANCUTG_BACKEND_STORE_PATH=/pfad/zur/store-datei npm run api:start
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
- MancuTG-PaperC ist als eigenstaendiger Produktname reserviert, aber noch nicht implementiert

### Noch nicht als vollstaendiges Produkt umgesetzt

- echte Tauri-/React-Oberflaeche
- Overlay/HUD
- Replay-/Timeline-Viewer
- persistentes Multi-User-/Auth-Backend
- Web-Profile, Sharing und Team-Funktionen

## Aktuelle Produktinvarianten

- MancuTG-ArenaC bleibt **ohne Account** und **ohne laufenden MancuTG-backend** lokal nutzbar.
- Arena wird ausschliesslich ueber **read-only Log Parsing** eingebunden.
- Sync, Telemetrie und Archidekt sind **optional** und durch Privacy-/Mode-Logik gated.
- iOS/iPadOS-Tracking ist **nur per Offline-Logimport** unterstuetzt; kein Live-Tracking, Overlay oder Sandbox-Zugriff auf dem Geraet.
- MancuTG-ArenaC unterstuetzt exportierte iOS-Logs per **Drag & Drop** und **Ordnerimport** mit Deduplizierung und `ios`-Plattformtagging.
- Der Exportweg fuer iOS-Logs setzt **nicht iTunes voraus**; Apple Devices (Windows), Finder (macOS) und notfalls Drittanbieter-Dateiwerkzeuge werden als Guidance modelliert.
- Archidekt ist in der ersten Stufe **read-only** und wird serverseitig ueber MancuTG-backend isoliert.
- Eine spaetere iOS-App wird nur als **Viewer/Sync/Import-Helper** betrachtet, nicht als Live-Tracker.
- MancuTG-PaperC ist die reservierte Bezeichnung fuer die separate Papierkarten-Video-Tracking-App.
- Neue Arbeit in diesem Repository bleibt **Apache-2.0-kompatibel**.
