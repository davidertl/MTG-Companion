# MTG-Companion

Ein einheitlicher, offline-tauglicher Companion fuer MTG Arena mit optionalem Backend fuer Sync, Aggregationen und plattformuebergreifende Erweiterungen.

## Produktthese

Bestehende Arena-Tracker loesen jeweils nur Teilprobleme gut:

- lokale Companion-Nutzung ohne Pflichtaccount
- Overlay/HUD waehrend des Spiels
- Match-History, Collection- und Economy-Tracking
- Draft-Werkzeuge und spaeter Replay-/Timeline-Funktionen
- optionale, nicht erzwungene Cloud-Synchronisation

Dieses Repository definiert die Zielarchitektur fuer eine neue App, die diese Faehigkeiten in einem Produkt zusammenfuehrt.

## Festgelegte Produktentscheidungen

- **Backend vorhanden, aber nicht verpflichtend:** Der Desktop-Companion bleibt lokal nuetzlich, auch ohne Account oder laufenden Server.
- **Offline-first:** Parsing, lokaler Event-Store, Overlay, Match-History und Exporte funktionieren ohne Cloud.
- **Log-only Integration:** MTG Arena wird ausschliesslich ueber read-only Log Parsing angebunden.
- **Archidekt eingebunden:** Deck-Import und spaetere Sync-Flows werden ueber einen dedizierten Archidekt-Connector modelliert.
- **iOS/iPadOS ueber Offline-Import:** Exportierte MTG Arena iPhone/iPad-Logs koennen lokal importiert werden, ohne Live-Tracking auf dem Geraet.
- **Apache 2.0:** Neue Projektergebnisse in diesem Repo werden unter Apache-2.0 lizenziert.

## Dokumente

- `docs/architecture/unified-mtg-companion-architecture.md` - Produkt- und Zielarchitektur
- `docs/plans/2026-05-06-001-feat-unified-mtg-companion-platform-plan.md` - technische Umsetzungsplanung
- `docs/privacy/data-flow.md` - dokumentierter Datenfluss fuer Offline-, Sync- und Telemetriepfade
- `LICENSE` - Apache License 2.0

## Architektur in einem Satz

Der Companion ist ein lokaler Desktop-Client mit eigenem Event-Store; ein optionales Backend uebernimmt Sync, konto-basierte Mehrgeraete-Funktionen, aggregierte Analytics und Integrationen wie Archidekt, ohne den Kernnutzen des Clients davon abhaengig zu machen.

## Implementierter Stand

Das Repository enthaelt jetzt eine lauffaehige Grundimplementierung der Plattform:

- **Rust-Kernmodule**
  - `crates/core-domain` - gemeinsame Event- und Snapshot-Typen
  - `crates/core-parser` - log-only Parser fuer normalisierte Events und Unknown-Event-Capture
  - `crates/core-store` - SQLite-basierter lokaler Event-Store und Projektionen
  - `crates/core-sync` - Outbox-/Sync-Objekte fuer optionale Backend-Synchronisation
- **Desktop-Kern**
  - `apps/desktop/src-tauri` - Offline-Bootstrap ueber Parser + Event-Store
  - `apps/desktop/src` - route-nahe Query-, Export-, Privacy-, Setup- und Deck-Cache-Logik
  - inklusive iOS/iPadOS-Offline-Importflow fuer `.log`-Dateien per Drag & Drop oder Ordnerimport
- **Backend-Grundlage**
  - `services/api/src` - optionale Sync-, Auth-, Archidekt-Import- und Telemetry-Services
  - `services/worker/src` - Hintergrundjob-Grundlage fuer serverseitige Verarbeitungsaufgaben
- **Archidekt-Connector**
  - `services/archidekt-connector/src/connector.py` - read-only Import ueber `pyrchidekt`-kompatiblen Adapter
- **Gemeinsame Vertrage**
  - `packages/shared-schema/src` - zod-validierte Schemas fuer Sync-, Privacy- und Deck-Snapshots

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

### Benutzbare Foundations-Einstiegspunkte

#### Desktop-Kern als CLI

Usage anzeigen:

```bash
npm run desktop:help
```

Lokales Log bootstrapen:

```bash
cargo run -p desktop-core -- bootstrap "/pfad/zur/Player.log"
```

Einzelne exportierte iOS-Logdatei importieren:

```bash
cargo run -p desktop-core -- import-ios-file "/pfad/zur/exportierten.log" "/pfad/zur/mtg-companion.sqlite3"
```

Einen Ordner mit exportierten iOS-Logs importieren:

```bash
cargo run -p desktop-core -- import-ios-folder "/pfad/zum/export-ordner" "/pfad/zur/mtg-companion.sqlite3"
```

#### Optionaler API-Server

Den Foundations-API-Server lokal starten:

```bash
npm run api:start
```

Verfuegbare Endpunkte:

- `GET /health`
- `POST /sync`
- `GET /integrations/archidekt/:deckId`

## Audit des aktuellen Zustands

### Bereits funktional

- Rust-Parser, lokaler SQLite-Store und Projektionen
- degradierbares Desktop-Bootstrap aus lokalen Logs
- iOS/iPadOS-Offline-Import mit Deduplizierung und `ios`-Tagging
- TypeScript-Desktop-State fuer Setup, History, Collection, Draft, Privacy und Import-Center
- startbarer API-Server fuer Health, Sync und Archidekt-Import
- read-only Archidekt-Connector in Python

### Noch nicht als vollstaendiges Produkt umgesetzt

- echte Tauri-/React-Oberflaeche
- Overlay/HUD
- Replay-/Timeline-Viewer
- persistentes Multi-User-/Auth-Backend
- Web-Profile, Sharing und Team-Funktionen

## Aktuelle Produktinvarianten

- Der Companion bleibt **ohne Account** und **ohne laufendes Backend** lokal nutzbar.
- Arena wird ausschliesslich ueber **read-only Log Parsing** eingebunden.
- Sync, Telemetrie und Archidekt sind **optional** und durch Privacy-/Mode-Logik gated.
- iOS/iPadOS-Tracking ist **nur per Offline-Logimport** unterstuetzt; kein Live-Tracking, Overlay oder Sandbox-Zugriff auf dem Geraet.
- Der Desktop-Companion unterstuetzt exportierte iOS-Logs per **Drag & Drop** und **Ordnerimport** mit Deduplizierung und `ios`-Plattformtagging.
- Der Exportweg fuer iOS-Logs setzt **nicht iTunes voraus**; Apple Devices (Windows), Finder (macOS) und notfalls Drittanbieter-Dateiwerkzeuge werden als Guidance modelliert.
- Archidekt ist in der ersten Stufe **read-only** und wird serverseitig ueber einen Connector isoliert.
- Eine spaetere iOS-App wird nur als **Viewer/Sync/Import-Helper** betrachtet, nicht als Live-Tracker.
- Neue Arbeit in diesem Repository bleibt **Apache-2.0-kompatibel**.
