---
title: feat: Close the foundation-to-functional gap
type: feat
status: completed
date: 2026-05-06
---

# feat: Close the foundation-to-functional gap

## Summary

Dieses Dokument gleicht den bestehenden Foundations-Plan mit dem echten Repo-Zustand ab und beschreibt die verbleibenden Luecken zwischen "saubere Grundstruktur" und "tatsaechlich benutzbarer Produktflaeche". Der Fokus liegt darauf, die bereits gebauten Kernmodule ueber benutzbare End-to-End-Pfade zusammenzufuehren: Desktop-Import/Reporting, Import-Center-State und einen startbaren API-Server.

---

## Problem Frame

Der bisherige Plan ist als Foundations-Plan korrekt abgeschlossen: Parser, Store, Desktop-State-Helfer, Archidekt-Connector und Shared Schemas sind vorhanden und getestet. Gleichzeitig fehlt an mehreren Stellen noch die funktionale Schicht, ueber die Nutzer oder Integratoren diese Faehigkeiten wirklich ausfuehren koennen. Die Codebasis ist deshalb technisch tragfaehig, aber noch nicht ueberall produktartig benutzbar.

---

## Audit: Plan vs. aktueller Zustand

### Bereits eingebaut und funktionsfaehig

- Repository-/Workspace-Struktur fuer Desktop, Rust-Kern, API, Worker und Connector
- Apache-2.0-Lizenzierung und Architektur-/Privacy-Dokumentation
- Rust-Parser mit Golden-Log-Tests
- SQLite-Event-Store mit Projektionen fuer Match-History, Collection, Inventory und Draft
- deduplizierte Persistenz fuer Events/Chunks
- degradierbares Desktop-Bootstrap aus Logdateien
- Shared TypeScript Schemas fuer Sync, Privacy, Deck-Snapshots
- read-only Archidekt-Connector in Python inklusive Validierung
- optionale API-Vertragslogik fuer Sync, Telemetrie und Archidekt-Import
- iOS/iPadOS-Offline-Importlogik im Rust-Kern inklusive Plattform-Tagging und Guidance-Helfern

### Eingebaut, aber nur als Foundation / noch nicht als benutzbarer Produktpfad

- Desktop-Import existiert im Rust-Kern, aber nicht als sichtbare Import-Center-Flaeche mit zusammengefasstem Zustand
- Backend-Routen existieren als Funktionslogik, aber nicht als startbarer HTTP-Server
- Worker-Logik existiert als Job-Ableitung, aber nicht als ausfuehrbarer Batch-/Runtime-Pfad
- Desktop-Kern ist als Library vorhanden, aber nicht als expliziter CLI-/Shell-Einstiegspunkt fuer Importe und Reports

### Noch nicht implementiert

- produktionsnahe Tauri-/React-Oberflaeche
- echtes Overlay/HUD
- Replay-/Timeline-Viewer
- Team-/Sharing-/Web-Profile
- bidirektionale Archidekt-Flows
- Account-/Auth-Backend mit echter Persistenz

---

## Requirements

- R1. Der bestehende Foundations-Stand muss gegen den aktuellen Codezustand explizit auditiert und dokumentiert werden.
- R2. Bereits funktionierende Faehigkeiten muessen klar von vorbereiteten, aber noch nicht benutzbaren Flaechen getrennt werden.
- R3. Der Desktop muss einen benutzbaren End-to-End-Einstiegspunkt fuer lokale Bootstrap- und iOS-Offline-Importfluesse erhalten.
- R4. Der API-Teil muss als startbarer HTTP-Server verfuegbar sein, nicht nur als interne Funktionslogik.
- R5. Die Desktop-Schicht muss einen ausdruecklichen Import-Center-/Import-Report-State fuer Offline-Importe erhalten.
- R6. Die neue Funktionalisierung darf die bisherigen Offline-first-, read-only- und Apache-2.0-Invarianten nicht verletzen.

---

## Scope Boundaries

- Dieses Dokument zieht die Foundations in benutzbare End-to-End-Pfade, aber baut noch keine vollstaendige Tauri-GUI.
- Ein echtes Multi-User-/Produktions-Backend mit Datenbank, Auth und Deploy-Topologie ist nicht Teil dieses Schritts.
- Overlay, Replay, Web-Profile und Team-Funktionen bleiben ausserhalb dieses Ausbaus.

### Deferred to Follow-Up Work

- Tauri-Windowing, Datei-Picker und echte GUI-Interaktion
- persistente Server-Datenbank und Auth
- Replay-/Timeline-Produktisierung
- Overlay-Implementierung

---

## Key Technical Decisions

- **Audit und Umsetzung im selben Zug:** Der Plan dokumentiert nicht nur Gaps, sondern schliesst die hoechstwertigen funktionalen Luecken direkt.
- **Rust-CLI fuer Desktop-Kern:** Statt auf eine noch nicht vorhandene Tauri-GUI zu warten, bekommt der Desktop-Kern einen expliziten Einstiegspunkt fuer Bootstrap- und iOS-Import-Workflows.
- **HTTP-Server ueber vorhandene API-Routen:** Die bestehende Typ- und Vertragslogik wird ueber einen kleinen startbaren Server exponiert, statt ein neues Backend parallel zu erfinden.
- **Import-Center als zustandsorientierte Desktop-Schicht:** Die TypeScript-Desktop-Layer bekommt einen konkreten Import-Center-State statt nur einzelner Guidance-Helfer.

---

## Implementation Units

- U1. **Audit artefacts and remaining-work mapping**

**Goal:** Den aktuellen Codezustand gegen den Foundations-Plan dokumentieren und daraus die verbleibenden funktionalen Luecken explizit machen.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Create: `docs/plans/2026-05-06-002-feat-foundation-functionalization-plan.md`
- Modify: `README.md`

**Approach:**
- Explizite Dreiteilung in "funktioniert", "nur Foundation", "noch nicht implementiert".
- Den README-Zustandsabschnitt auf den Audit abgleichen.

**Patterns to follow:**
- `docs/plans/2026-05-06-001-feat-unified-mtg-companion-platform-plan.md`

**Test scenarios:**
- Test expectation: none -- Dokumentations- und Planungsartefakt.

**Verification:**
- Ein Leser kann den aktuellen Reifegrad des Repos ohne Code-Deep-Dive erkennen.

---

- U2. **Runnable desktop import/report entrypoints**

**Goal:** Den Rust-Desktop-Kern ueber eine benutzbare CLI fuer Bootstrap- und iOS-Offline-Import-Workflows verfuegbar machen.

**Requirements:** R3, R6

**Dependencies:** U1

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/tests/offline_bootstrap.rs`
- Modify: `apps/desktop/src-tauri/tests/ios_import.rs`
- Modify: `Cargo.toml`
- Modify: `package.json`

**Approach:**
- Eine kleine CLI mit klaren Subcommands (`bootstrap`, `import-ios-file`, `import-ios-folder`) bereitstellen.
- Ergebnisse als JSON ausgeben, damit der Pfad sowohl fuer Menschen als auch fuer spaetere GUI/Automation taugt.

**Test scenarios:**
- Happy path: Bootstrap eines lokalen Logs liefert Match-/Snapshot-Report als strukturierte Ausgabe.
- Happy path: iOS-Dateiimport liefert Import-Summary mit `ios`-Tagging.
- Edge case: wiederholter iOS-Import bleibt dedupliziert.
- Error path: ungueltige CLI-Aufrufe geben klare Fehlermeldungen aus.

**Verification:**
- Der Desktop-Kern kann ohne GUI als benutzbarer Import-/Bootstrap-Prozess gestartet werden.

---

- U3. **Import center state for desktop flows**

**Goal:** Die Desktop-TypeScript-Schicht um einen ausdruecklichen Import-Center-State erweitern, der lokale und iOS-Offline-Importe sichtbar beschreibt.

**Requirements:** R2, R5, R6

**Dependencies:** U1

**Files:**
- Create: `apps/desktop/src/routes/imports/index.ts`
- Modify: `apps/desktop/src/index.ts`
- Create: `apps/desktop/tests/import-center.spec.ts`
- Modify: `apps/desktop/tests/smoke/app-shell.spec.ts`

**Approach:**
- Importmethoden, letzte Importzusammenfassung, Guidance und Produktgrenzen in einem Route-State zusammenfassen.
- iOS-Offline-Import als benutzbare Surface beschreiben, nicht nur als Setup-Hinweis.

**Test scenarios:**
- Happy path: Der Import-Center-State zeigt Desktop- und iOS-Offline-Import als verfuegbare Pfade.
- Happy path: Eine letzte iOS-Importzusammenfassung wird sichtbar mit `ios`-Tag und Deduplizierungsdaten.
- Edge case: Ohne bisherigen Import bleibt der State valide und guidance-first.

**Verification:**
- Die Desktop-Schicht besitzt eine klare Importsurface fuer spaetere UI-Bindung.

---

- U4. **Runnable API server over existing contracts**

**Goal:** Die vorhandene Sync-/Archidekt-/Health-Logik als startbaren HTTP-Server bereitstellen.

**Requirements:** R4, R6

**Dependencies:** U1

**Files:**
- Create: `services/api/src/server.ts`
- Create: `services/api/src/main.ts`
- Modify: `services/api/src/index.ts`
- Create: `services/api/tests/server.spec.ts`
- Modify: `package.json`

**Approach:**
- Kleinen Node-basierten HTTP-Server ueber die bestehenden Routen legen.
- Health-, Sync- und Archidekt-Endpunkte bereitstellen.
- In-Memory-Store als Default fuer den funktionalen Foundations-Stand verwenden.

**Test scenarios:**
- Happy path: `GET /health` liefert einen gesunden Status.
- Happy path: `POST /sync` akzeptiert gueltige Payloads anonym oder authentifiziert.
- Happy path: `GET /integrations/archidekt/:deckId` liefert validierte Snapshots.
- Error path: ungueltige Payloads liefern 4xx statt stiller Fehler.

**Verification:**
- Die API kann als echter Server gestartet und gegen Endpunkte getestet werden.

---

## Verification

- `npm run typecheck`
- `npm run test:ts`
- `npm run test:rust`
- `npm run test:python`
- `npm test`

