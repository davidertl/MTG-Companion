---
title: feat: Implement the app-spanning event model
type: feat
status: active
date: 2026-05-07
---

# feat: Implement the app-spanning event model

## Summary

Dieses Dokument beschreibt die konkrete Zielstruktur fuer ein echtes app-uebergreifendes Eventmodell in MancuTG-Companion. Statt nur einen gemeinsamen Transportumschlag zu teilen, sollen MancuTG-ArenaC, MancuTG-PaperC und MancuTG-backend auf denselben Kernbegriffen fuer Sessions, Ereignisse, Provenienz, Confidence und Korrekturen aufbauen.

---

## Problem Frame

Aktuell teilen MancuTG-ArenaC und MancuTG-PaperC zwar bereits denselben `/events`-Kanal, aber die gemeinsame Struktur ist noch zu duenn, um wirklich als einheitliches Domänenmodell zu gelten. Es fehlen app-uebergreifende Kernfelder fuer Sessionbezug, Match-/Game-Kontext, Provenienz, Reviewstatus und robustere Identitaet. Dadurch bleibt das Backend bei der Semantik wieder auf app-spezifische Payloads angewiesen, obwohl die Architektur und die Research-Dokumente einen gemeinsamen Ereigniskanons fordern.

---

## Requirements

- R1. MancuTG-ArenaC, MancuTG-PaperC und MancuTG-backend muessen dieselbe app-uebergreifende Grundstruktur fuer Events teilen.
- R2. Das Modell muss zwischen `session`-Kontext und `event`-Inhalt unterscheiden.
- R3. Das Modell muss gemeinsame Kernfelder fuer Identitaet, Provenienz, Confidence und Korrekturfluss bereitstellen.
- R4. MancuTG-backend muss den neuen Batch-Umschlag fuer Sessions und Events ueber `/events` validieren und speichern koennen.
- R5. Deduplizierung muss robuster als nur `sourceApp + eventId` sein und mindestens den Sessionkontext einschliessen.
- R6. Das Modell muss serverseitig erzeugte Ereignisse ebenfalls ausdruecken koennen, statt nur ArenaC und PaperC zuzulassen.
- R7. Das Design muss mit dem vorhandenen append-only/Projektionsansatz kompatibel bleiben.

---

## Scope Boundaries

- Diese Arbeit fuehrt die gemeinsame Zielstruktur und deren Foundations-Implementierung ein, nicht die gesamte spaetere Projektions-, Review- oder Media-Pipeline.
- ArenaC- oder PaperC-spezifische Vollmodelle werden nur soweit modelliert, wie es fuer den gemeinsamen Kernvertrag erforderlich ist.
- Es wird keine neue persistente Datenbanktopologie ausserhalb des bestehenden In-Memory-Backends eingefuehrt.

### Deferred to Follow-Up Work

- Vollstaendige PaperC-spezifische Vertragsmodule fuer Turnier-/Capture-/Reviewkontext
- Persistente Backend-Speicherung und Cursor-Sync
- Erweiterte Eventabfrage- und Replay-APIs
- Ausfuehrliche Konfliktauflosungs- und Reviewprojektoren

---

## Context & Research

### Relevant Code and Patterns

- `packages/shared-schema/src/events.ts`: aktueller minimaler Event-Umschlag
- `services/api/src/domain/eventService.ts`: aktuelle Deduplizierung nur ueber `sourceApp + eventId`
- `services/api/src/routes/events.ts`: aktueller `/events`-Vertrag
- `services/api/src/server.ts`: aktueller HTTP-Endpunkt
- `docs/architecture/unified-mtg-companion-architecture.md`: Architekturziel fuer gemeinsame Event-Ingestion
- `docs/plans/2026-05-06-003-feat-mancutg-paperc-tournament-video-detection-plan.md`: PaperC-Plan, der bereits mehr Kontext und Partitionierung voraussetzt
- hochgeladene Research-Reports mit empfohlenem kanonischen Session-/Eventmodell

### Institutional Learnings

- Die aktuellen Repo-Dokumente behandeln `/events` als gemeinsamen Basiskanal, aber noch nicht als vollstaendigen app-uebergreifenden Kanon.
- Das Research betont, dass Rohquellen fluechtig sind und der gemeinsame Server stattdessen auf stabilen Domänenfeldern beruhen muss.

### External References

- Session-provided deep research report on unified event modeling and sync protocol

---

## Key Technical Decisions

- **Session und Event werden getrennt modelliert:** Die Backend-Ingestion nimmt einen Batch-Umschlag mit `sessions` und `events`.
- **Server ist auch ein Producer:** `sourceApp` wird um `mancutg-backend` erweitert, damit Review-, Korrektur- und Finalisierungsereignisse im selben Modell leben koennen.
- **Eventidentitaet wird sessionbewusst:** Die Deduplizierungsbasis wird auf `sourceApp + sourceSessionId + eventId` gehoben.
- **Gemeinsamer Kanon statt rein freier Payload:** Ein Event bekommt gemeinsame Kernfelder wie `matchId`, `gameId`, `streamId`, `actor`, `object`, `targets`, `provenance`, `confidence`, `reviewStatus` und `supersedesEventId`.
- **Payload bleibt als Erweiterung erhalten:** App-spezifische Details koennen weiter in `payload` liegen, aber nicht mehr als einziger Bedeutungstraeger.
- **Batch-Idempotenz wird vorbereitet:** Ein optionaler `idempotencyKey` wird Teil des Ingest-Umschlags.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    A[Session batch envelope] --> B[sessions[]]
    A --> C[events[]]
    B --> D[session store]
    C --> E[event validator]
    E --> F[event store]
    F --> G[dedupe: sourceApp + sourceSessionId + eventId]
    G --> H[projectors / review / analytics]
```

---

## Output Structure

    packages/
      shared-schema/
        src/
          events.ts
    services/
      api/
        src/
          domain/
            eventService.ts
          routes/
            events.ts
          server.ts
        tests/
          events-contract.spec.ts
          server.spec.ts
    docs/
      architecture/
      plans/
      privacy/

---

## Implementation Units

- U1. **Shared session and event schemas**

**Goal:** Den gemeinsamen Kernvertrag fuer Sessions und Events definieren, der von ArenaC, PaperC und backendseitigen Prozessen gleichermassen verwendet wird.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** None

**Files:**
- Modify: `packages/shared-schema/src/events.ts`
- Modify: `packages/shared-schema/src/index.ts`
- Test: `services/api/tests/events-contract.spec.ts`

**Approach:**
- `eventSourceAppSchema` auf `mancutg-arenac`, `mancutg-paperc`, `mancutg-backend` erweitern.
- `backendEventSessionSchema` einfuehren.
- `backendEventEnvelopeSchema` um app-uebergreifende Kernfelder erweitern.
- `backendEventBatchEnvelopeSchema` fuer `/events` einfuehren.

**Patterns to follow:**
- `packages/shared-schema/src/events.ts`

**Test scenarios:**
- Happy path: ArenaC- und PaperC-Events validieren gegen dieselbe Grundstruktur.
- Happy path: backendseitige Korrektur-/Review-Ereignisse sind ebenfalls gueltig.
- Edge case: optionale Domänenfelder koennen fehlen, ohne das Grundmodell zu brechen.
- Error path: fehlende Pflichtfelder wie `sourceSessionId` oder `provenance` werden abgelehnt.

**Verification:**
- Ein gemeinsamer Schema-Export deckt alle drei App-Rollen ab: ArenaC, PaperC, backend.

---

- U2. **Backend event batch ingest**

**Goal:** MancuTG-backend auf den neuen Batch-Umschlag fuer Sessions und Events umstellen.

**Requirements:** R2, R4, R5, R6, R7

**Dependencies:** U1

**Files:**
- Modify: `services/api/src/domain/eventService.ts`
- Modify: `services/api/src/routes/events.ts`
- Modify: `services/api/src/server.ts`
- Test: `services/api/tests/events-contract.spec.ts`
- Test: `services/api/tests/server.spec.ts`

**Approach:**
- EventStore um Session-Speicherung und Batch-Key-Tracking erweitern.
- Eventingest validiert zunaechst Sessions, dann Events.
- Events muessen auf bekannte Sessions referenzieren.
- Dedupe ueber `sourceApp + sourceSessionId + eventId`.

**Execution note:** Start with a failing route/service test for the new envelope before aligning the route and store implementation.

**Patterns to follow:**
- `services/api/src/domain/eventService.ts`
- `services/api/src/routes/events.ts`

**Test scenarios:**
- Happy path: Ein Batch mit Sessions und Events wird erfolgreich gespeichert.
- Happy path: ArenaC- und PaperC-Events koexistieren im selben Batch.
- Edge case: Wiederholter Batch mit gleichem `idempotencyKey` wird als dedupliziert behandelt.
- Edge case: Gleiche `eventId` in zwei verschiedenen Sessions kollidiert nicht.
- Error path: Event referenziert unbekannte Session und wird abgelehnt.

**Verification:**
- MancuTG-backend nimmt den neuen app-uebergreifenden Batchvertrag erfolgreich ueber `/events` an.

---

- U3. **Documentation alignment**

**Goal:** README, Architektur und Planungsdokumente auf die konkrete Zielstruktur des app-uebergreifenden Eventmodells aktualisieren.

**Requirements:** R1, R3, R4, R5, R6

**Dependencies:** U1, U2

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/unified-mtg-companion-architecture.md`
- Modify: `docs/privacy/data-flow.md`
- Modify: `docs/plans/2026-05-06-003-feat-mancutg-paperc-tournament-video-detection-plan.md`

**Approach:**
- Die aktuelle 5-Felder-Huelle durch den konkreten Session-/Event-Batchvertrag ersetzen.
- Klarstellen, dass `payload` nur noch Erweiterungsraum ist, nicht der ganze semantische Vertrag.

**Patterns to follow:**
- `README.md`
- `docs/architecture/unified-mtg-companion-architecture.md`

**Test scenarios:**
- Test expectation: none -- Dokumentations- und Planungsangleichung.

**Verification:**
- Code und Doku beschreiben denselben Zielvertrag.

---

## System-Wide Impact

- **Interaction graph:** ArenaC, PaperC und backendseitige Prozesse teilen denselben Session-/Event-Kanon.
- **Error propagation:** Ungueltige oder unvollstaendige Eventbatches scheitern frueh auf Schema- oder Session-Validierung.
- **State lifecycle risks:** Falsche Sessionreferenzen oder schwache Eventidentitaet erzeugen Cross-App-Kollisionen; genau diese werden mit der neuen Struktur reduziert.
- **API surface parity:** `/events` wird der gemeinsame Ingest-Kanal, waehrend Sync ein getrennter Vertrag bleibt.
- **Unchanged invariants:** ArenaC bleibt log-only; PaperC bleibt ein eigener Produzent; MancuTG-backend bleibt optional fuer ArenaC-Lokalworkflows.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Das Modell wird zu abstrakt und schwer benutzbar | gemeinsame Kernfelder klein halten, app-spezifische Details weiter in `payload` erlauben |
| Bestehende Eventnutzung bricht hart | Tests und Doku in derselben Aenderung auf den neuen Vertrag ziehen |
| backendseitige Ereignisse passen nicht in dieselbe Familie | `sourceApp = mancutg-backend` explizit erlauben |
| Dedupe bleibt trotz neuem Modell zu schwach | Sessionkontext verpflichtend machen und `idempotencyKey` vorbereiten |

---

## Documentation / Operational Notes

- README und Architektur sollten den Batch-Umschlag mit `sessions[]` und `events[]` zeigen.
- Follow-up-Arbeit sollte `payload` weiter in app-spezifische, aber schema-validierte Erweiterungsbereiche schneiden.

---

## Sources & References

- Related code: `packages/shared-schema/src/events.ts`
- Related code: `services/api/src/domain/eventService.ts`
- Related code: `services/api/src/routes/events.ts`
- Related code: `services/api/src/server.ts`
- Related code: `docs/architecture/unified-mtg-companion-architecture.md`
- Related code: `docs/plans/2026-05-06-003-feat-mancutg-paperc-tournament-video-detection-plan.md`
- External docs: uploaded deep research report on unified event modeling
