---
title: plan: MancuTG-Companion project charter
type: plan
status: active
date: 2026-05-07
---

# plan: MancuTG-Companion project charter

## Purpose

Define one stable project-level source of truth that all sub-plans inherit.

## Product lines

- **MancuTG-ArenaC**: Windows-first MTG Arena companion, offline-first, local store.
- **MancuTG-PaperC**: paper tournament capture/review pipeline, phased after ArenaC MVP.
- **MancuTG-backend**: optional additive service for sync, aggregation, review workflows, and integrations.

## Non-negotiable invariants

- Offline-first local value for ArenaC without account/backend.
- Read-only Arena integration (logs only; no memory/process/network interception).
- Shared app-spanning event model for ArenaC, PaperC, backend producers.
- Append-only event history + projector-derived read models.
- Apache-2.0 clean-room implementation discipline.

## Current strategic decisions

- Windows MVP shell for ArenaC is Overwolf (`2026-05-07-003`).
- ArenaC product completion is prioritized before deep PaperC runtime expansion.
- Backend early scope remains constrained to shared contracts + ArenaC MVP needs.

## Out of scope for current cycle

- Full Arena overlay/HUD productization.
- Full PaperC detection/review operations at scale.
- Multi-user production auth/roles and complete web product surface.

## Canonical references

- Architecture: `docs/plans/2026-05-07-012-plan-architecture.md`
- ArenaC: `docs/plans/2026-05-07-013-plan-arenac.md`
- PaperC: `docs/plans/2026-05-07-014-plan-paperc.md`
- Event/API protocol: `docs/plans/2026-05-07-015-plan-api-event-protocol.md`
- Backend: `docs/plans/2026-05-07-016-plan-backend.md`
- Roadmap: `docs/plans/2026-05-07-017-plan-implementation-roadmap.md`
