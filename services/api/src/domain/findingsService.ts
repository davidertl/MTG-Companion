import {
  analysisFindingSchema,
  ANALYSIS_FINDING_RAISED_EVENT_TYPE,
  ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
  ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
  type AnalysisAudience,
  type AnalysisFinding,
  type FindingVisibilityMode,
  type TournamentRole,
} from "../../../../packages/shared-schema/src/index.ts";
import type { Store, StoredEvent } from "../store/types.ts";

/**
 * Findings read model + the security-critical visibility resolution (plan
 * unit W3.3).
 *
 * Analysis findings/suggestions are events: they arrive over the ordinary
 * `POST /events` pipeline as `analysis.finding.raised` /
 * `analysis.suggestion.raised` envelopes whose payload matches
 * `analysisFindingSchema` and additionally carries the owning `tournamentId`
 * (so the append-only event store indexes them per tournament). This module
 * projects those events into a findings read model and decides — with a single
 * table-driven, default-DENY pure function — whether a given finding is visible
 * to a given requester.
 *
 * Enforcement lives on the server: a hidden finding is simply absent from a
 * player's response (never a 403 for that item), so finding *presence* never
 * leaks. Client-side suppression is cosmetic; this is the authority.
 */

/** A finding projected from the event stream, plus its latest review state. */
export interface ProjectedFinding {
  finding: AnalysisFinding;
  tournamentId: string;
  /** Store cursor of the raising event — stable ordering key. */
  cursor: number;
  review: ProjectedReview | null;
}

export interface ProjectedReview {
  resolution: "confirmed" | "dismissed" | "corrected";
  reviewedBy: string;
  reviewedAt: string;
  note?: string;
}

export interface VisibilityInput {
  mode: FindingVisibilityMode;
  audience: AnalysisAudience;
  role: TournamentRole;
}

const RAISED_EVENT_TYPES = new Set<string>([
  ANALYSIS_FINDING_RAISED_EVENT_TYPE,
  ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
]);

/**
 * The single source of truth for referee-only routing. Table-driven and
 * default-deny: every path that is not explicitly allowed returns `false`.
 *
 * Rules (see W3.3 spec):
 * - referee/organizer (the "referee tier") see everything, always;
 * - a `referee-only` audience finding is NEVER visible outside the referee
 *   tier;
 * - while a tournament's mode is `referee-only`, players/spectators see
 *   NOTHING, regardless of a finding's audience;
 * - in `players` mode, `all`-audience findings are visible to everyone
 *   (including spectators) and `players`-audience findings are visible to
 *   players only.
 */
export function isFindingVisible({ mode, audience, role }: VisibilityInput): boolean {
  // Referee tier: full visibility, independent of mode/audience.
  if (role === "organizer" || role === "referee") {
    return true;
  }

  // Non-referee tier (player, spectator) from here on.

  // Referee-only mode blacks out the entire non-referee tier.
  if (mode === "referee-only") {
    return false;
  }

  // Referee-only audience is never routed outside the referee tier.
  if (audience === "referee-only") {
    return false;
  }

  // mode === "players" here.
  if (audience === "all") {
    return true; // everyone, including spectators
  }
  if (audience === "players") {
    return role === "player"; // players only, not spectators
  }

  // Default deny (unreachable given the enum, but the invariant is explicit).
  return false;
}

/** Pages through every tournament-scoped event in stable cursor order. */
function readAllTournamentEvents(store: Store, tournamentId: string): StoredEvent[] {
  const pageSize = 500;
  const all: StoredEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.readEventsAfter(cursor, pageSize, tournamentId);
    if (page.length === 0) {
      break;
    }
    all.push(...page);
    cursor = page[page.length - 1].cursor;
    if (page.length < pageSize) {
      break;
    }
  }
  return all;
}

/**
 * Folds the tournament's event stream into the findings read model. Raised
 * findings/suggestions become entries (latest raise for a `findingId` wins);
 * `analysis.finding.reviewed` events attach the latest review state by cursor.
 * Malformed analysis payloads are skipped rather than throwing — projection is
 * read-only and must never break a legitimate read.
 */
export function projectFindings(store: Store, tournamentId: string): ProjectedFinding[] {
  const events = readAllTournamentEvents(store, tournamentId);

  const byFindingId = new Map<string, ProjectedFinding>();
  const reviews = new Map<string, { review: ProjectedReview; cursor: number }>();

  for (const { cursor, event } of events) {
    if (RAISED_EVENT_TYPES.has(event.eventType)) {
      const parsed = analysisFindingSchema.safeParse(event.payload);
      if (!parsed.success) {
        continue;
      }
      byFindingId.set(parsed.data.findingId, {
        finding: parsed.data,
        tournamentId,
        cursor,
        review: null,
      });
      continue;
    }

    if (event.eventType === ANALYSIS_FINDING_REVIEWED_EVENT_TYPE) {
      const payload = event.payload as Record<string, unknown> | undefined;
      const findingId = typeof payload?.findingId === "string" ? payload.findingId : undefined;
      const resolution = payload?.resolution;
      if (
        !findingId ||
        (resolution !== "confirmed" && resolution !== "dismissed" && resolution !== "corrected")
      ) {
        continue;
      }
      const existing = reviews.get(findingId);
      if (!existing || cursor > existing.cursor) {
        reviews.set(findingId, {
          cursor,
          review: {
            resolution,
            reviewedBy: typeof payload?.reviewedBy === "string" ? payload.reviewedBy : "",
            reviewedAt: event.occurredAt,
            ...(typeof payload?.note === "string" ? { note: payload.note } : {}),
          },
        });
      }
    }
  }

  const projected: ProjectedFinding[] = [];
  for (const entry of byFindingId.values()) {
    const review = reviews.get(entry.finding.findingId);
    projected.push({ ...entry, review: review?.review ?? null });
  }
  projected.sort((left, right) => left.cursor - right.cursor);
  return projected;
}

/**
 * Returns only the findings visible to `role` under `mode`. This is the filter
 * a player's read passes through: hidden findings are dropped, so presence
 * never leaks.
 */
export function selectVisibleFindings(
  findings: ProjectedFinding[],
  mode: FindingVisibilityMode,
  role: TournamentRole,
): ProjectedFinding[] {
  return findings.filter((entry) =>
    isFindingVisible({ mode, audience: entry.finding.audience, role }),
  );
}
