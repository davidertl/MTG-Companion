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
- **Apache 2.0:** Neue Projektergebnisse in diesem Repo werden unter Apache-2.0 lizenziert.

## Dokumente

- `docs/architecture/unified-mtg-companion-architecture.md` - Produkt- und Zielarchitektur
- `docs/plans/2026-05-06-001-feat-unified-mtg-companion-platform-plan.md` - technische Umsetzungsplanung
- `LICENSE` - Apache License 2.0

## Architektur in einem Satz

Der Companion ist ein lokaler Desktop-Client mit eigenem Event-Store; ein optionales Backend uebernimmt Sync, konto-basierte Mehrgeraete-Funktionen, aggregierte Analytics und Integrationen wie Archidekt, ohne den Kernnutzen des Clients davon abhaengig zu machen.
