---
title: plan: communication protocol and event naming
type: plan
status: active
date: 2026-05-07
---

# plan: communication protocol and event naming

## Goal

Define a stable naming and payload protocol for app-to-backend event communication shared by ArenaC, PaperC, and backend producers.

## Canonical contract

- Transport contract lives in `packages/shared-schema/src/events.ts`.
- Batch shape: `{ idempotencyKey?, sessions[], events[] }`.
- Dedupe identity: `sourceApp + sourceSessionId + eventId`.

## Event naming convention

- Format: `<domain>.<entity>.<action>`
- Character set: lowercase letters, digits, dot separators.
- Required domains:
  - `arena.*` for ArenaC semantics
  - `paperc.*` for PaperC semantics
  - `backend.*` for backend-emitted corrections/finalizations

## Reserved semantic families

- Observation: `*.detected`, `*.observed`, `*.updated`
- Workflow/review: `*.review.requested`, `*.review.confirmed`, `*.review.rejected`
- State transitions: `*.started`, `*.completed`, `*.finalized`, `*.reopened`
- Data/system: `*.imported`, `*.synced`, `*.failed`

## Examples

- `arena.match.started`
- `arena.match.completed`
- `paperc.match.detected`
- `paperc.review.requested`
- `backend.review.corrected`
- `backend.match.finalized`

## Protocol rules

- `sourceApp` must be one of: `mancutg-arenac`, `mancutg-paperc`, `mancutg-backend`.
- Every event references an existing session (`sourceSessionId`).
- `provenance[]` is mandatory and non-empty.
- `confidence` stays in `[0,1]`; `reviewStatus` tracks adjudication lifecycle.
- App-specific fields remain in `payload`, but core routing/identity fields stay top-level.

## Change policy

- Additive changes only for stable consumers.
- Breaking schema or naming changes require:
  - migration note in this file,
  - matching update to `services/api` validation and tests,
  - explicit changelog entry in roadmap phase notes.

## References

- Shared contract implementation: `packages/shared-schema/src/events.ts`
- Backend ingest implementation: `services/api/src/domain/eventService.ts`
