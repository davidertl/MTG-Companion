---
title: "decision: MancuTG-ArenaC Windows shell is Overwolf (MVP)"
type: decision
status: active
date: 2026-05-07
---

# decision: MancuTG-ArenaC Windows shell is Overwolf (MVP)

## Context

MancuTG-ArenaC needs a presentable, easy-to-install UI on Windows. The repository previously targeted Tauri as the desktop shell; the interactive deliverable path is now **Overwolf** for the Windows-first MVP.

## Decision

- **Primary Windows UI shell:** Overwolf app under `apps/overwolf/`, hosting a React client that talks to the existing Rust core via a **localhost HTTP service** (`mancutg-arenac serve`).
- **Rust core:** Unchanged responsibilities (log parsing, SQLite store, checkpoints, imports, settings). Exposed to the UI through HTTP JSON endpoints, not only CLI.
- **In-game overlay / HUD:** Explicitly **out of scope** for this MVP; windowed app only.
- **Tauri:** Deferred as an alternative shell; architecture docs keep a swappable presentation boundary.

## Consequences

- Distribution: `.opk` packaging and Overwolf runtime (plus optional sideload for testers).
- CI: Windows job can produce unsigned `.opk` artifacts; code signing remains an operator step until secrets exist.
- Privacy and offline-first invariants are unchanged; network remains opt-in via existing settings model.

## References

- [docs/architecture/unified-mtg-companion-architecture.md](../architecture/unified-mtg-companion-architecture.md)
- [docs/release/overwolf-install.md](../release/overwolf-install.md)
