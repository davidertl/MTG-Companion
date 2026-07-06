import { z } from "zod";

import {
  backendEventEnvelopeSchema,
  ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
  type AnalysisFinding,
  type FindingVisibilityMode,
} from "../../../../../packages/shared-schema/src/index.ts";
import { NotFoundError, requireRole } from "../../auth/roles.ts";
import type { AuthenticatedUser } from "../../auth/tokens.ts";
import {
  projectFindings,
  selectVisibleFindings,
  type ProjectedReview,
} from "../../domain/findingsService.ts";
import type { Store } from "../../store/types.ts";

/**
 * Tournament findings routes (plan unit W3.3). Both handlers require an
 * authenticated user (the server resolves the bearer token before dispatch and
 * rejects anonymous callers with 401).
 *
 * - `GET  /tournaments/:id/findings` — any tournament member. Referees and
 *   organizers get every finding; players/spectators get only the findings the
 *   visibility rules permit. Hidden findings are absent from the response, never
 *   surfaced as a 403 — finding presence must not leak.
 * - `POST /tournaments/:id/findings/:findingId/review` — referee/organizer only.
 *   Appends an `analysis.finding.reviewed` event (append-only, human-in-the-loop
 *   review idiom borrowed from PaperC). Idempotent per (findingId, resolution).
 */

const ALL_ROLES = ["organizer", "referee", "player", "spectator"] as const;

const reviewBodySchema = z.object({
  resolution: z.enum(["confirmed", "dismissed", "corrected"]),
  note: z.string().min(1).optional(),
});

export interface FindingView {
  finding: AnalysisFinding;
  review: ProjectedReview | null;
}

export interface ListFindingsResult {
  tournamentId: string;
  findingVisibilityMode: FindingVisibilityMode;
  findings: FindingView[];
}

export interface ReviewFindingResult {
  review: {
    tournamentId: string;
    findingId: string;
    gameKey: string;
    resolution: "confirmed" | "dismissed" | "corrected";
    reviewedBy: string;
    note?: string;
  };
  /** True when this exact review (findingId + resolution) was already recorded. */
  duplicate: boolean;
}

/**
 * Lists the findings visible to the caller. The tournament's
 * `findingVisibilityMode` (defaulting to the frozen schema default when a
 * tournament predates settings) and the caller's role drive the filter.
 */
export function listFindingsRoute(
  store: Store,
  user: AuthenticatedUser,
  tournamentId: string,
): ListFindingsResult {
  // Membership is required (any role). This also 404s an unknown tournament and
  // 403s a non-member — neither of which leaks per-finding presence.
  const role = requireRole(store, tournamentId, user, [...ALL_ROLES]);

  const tournament = store.getTournament(tournamentId);
  if (!tournament) {
    // requireRole already guarantees existence, but keep the invariant explicit.
    throw new NotFoundError("tournament-not-found");
  }
  const mode: FindingVisibilityMode =
    tournament.settings?.findingVisibilityMode ?? "players";

  const projected = projectFindings(store, tournamentId);
  const visible = selectVisibleFindings(projected, mode, role);

  return {
    tournamentId,
    findingVisibilityMode: mode,
    findings: visible.map((entry) => ({ finding: entry.finding, review: entry.review })),
  };
}

/**
 * Records a referee/organizer review of a finding by appending an
 * `analysis.finding.reviewed` event. Idempotent: re-posting the same resolution
 * for the same finding is a no-op that reports `duplicate: true`.
 */
export function reviewFindingRoute(
  store: Store,
  user: AuthenticatedUser,
  tournamentId: string,
  findingId: string,
  input: unknown,
): ReviewFindingResult {
  requireRole(store, tournamentId, user, ["organizer", "referee"]);

  const body = reviewBodySchema.parse(input ?? {});

  const target = projectFindings(store, tournamentId).find(
    (entry) => entry.finding.findingId === findingId,
  );
  if (!target) {
    throw new NotFoundError("finding-not-found");
  }

  const { resolution } = body;
  const sourceApp = "mancutg-backend" as const;
  const sourceSessionId = `analysis-review:${tournamentId}`;
  // Deterministic event id keyed on the finding + resolution makes the append
  // idempotent: the same review posted twice hits the existing row.
  const eventId = `analysis-review:${findingId}:${resolution}`;
  const duplicate = store.hasEvent(sourceApp, sourceSessionId, eventId);

  if (!duplicate) {
    const envelope = backendEventEnvelopeSchema.parse({
      eventId,
      sourceApp,
      sourceSessionId,
      eventType: ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
      occurredAt: new Date().toISOString(),
      provenance: [{ sourceKind: "review-decision", sourceSessionId }],
      payload: {
        tournamentId,
        findingId,
        gameKey: target.finding.gameKey,
        resolution,
        reviewedBy: user.userId,
        ...(body.note ? { note: body.note } : {}),
      },
    });

    store.transaction(() => {
      store.appendEvent(envelope);
    });
  }

  return {
    review: {
      tournamentId,
      findingId,
      gameKey: target.finding.gameKey,
      resolution,
      reviewedBy: user.userId,
      ...(body.note ? { note: body.note } : {}),
    },
    duplicate,
  };
}
