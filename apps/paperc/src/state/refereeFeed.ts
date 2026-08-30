/**
 * Referee findings feed — pure state model (plan 2026-07-06-001 W4.2).
 *
 * This module is transport-agnostic on purpose: it knows nothing about HTTP,
 * polling intervals, or websockets. The RefereeView component owns the polling
 * loop (GET /tournaments/:id/findings every few seconds) and feeds every batch
 * it receives into {@link refereeFeedReducer} via a `merge` action. Because the
 * merge is idempotent and keyed by `findingId`, swapping the polling transport
 * for a future server-push channel is a drop-in change — the reducer contract
 * does not move.
 *
 * Ordering: findings are surfaced by severity (possible-violation first), then
 * by confidence (highest first), then by turn, then by id — a total, stable
 * order so the same feed always renders identically.
 */

import type {
  AnalysisFinding,
  AnalysisFindingSeverity,
} from "../../../../packages/shared-schema/src/index";

/** The three review resolutions the backend accepts (mirrors the API contract). */
export type ReviewResolution = "confirmed" | "dismissed" | "corrected";

/**
 * The review state attached to a finding. Populated either from a poll response
 * (server is authoritative — carries `reviewedAt`) or optimistically from a
 * successful `POST .../review` before the next poll catches up.
 */
export interface FeedReview {
  resolution: ReviewResolution;
  reviewedBy: string;
  reviewedAt?: string;
  note?: string;
}

/** A finding as held in the feed: the finding, its latest review, local ack. */
export interface FeedItem {
  finding: AnalysisFinding;
  review: FeedReview | null;
  /** Local-only acknowledgement (a referee marking they have seen it). */
  acknowledged: boolean;
}

/** A finding as it arrives from a poll (server shape: finding + optional review). */
export interface IncomingFinding {
  finding: AnalysisFinding;
  review?: FeedReview | null;
}

export interface RefereeFeedState {
  /** Findings keyed by `findingId` — the dedupe index. */
  items: Record<string, FeedItem>;
  /** `findingId`s in render order (severity, then confidence, then turn, id). */
  order: string[];
  /** `findingId`s with a review request currently in flight. */
  reviewing: Record<string, boolean>;
  /** Last poll error, if the most recent poll failed. Cleared on a good merge. */
  lastError: string | null;
  /** ISO timestamp of the last successful merge, for a "last updated" hint. */
  lastUpdatedAt: string | null;
}

export type RefereeFeedAction =
  | { type: "merge"; findings: IncomingFinding[]; at?: string }
  | { type: "pollError"; error: string }
  | { type: "reviewStart"; findingId: string }
  | { type: "reviewSuccess"; findingId: string; review: FeedReview }
  | { type: "reviewError"; findingId: string; error: string }
  | { type: "acknowledge"; findingId: string }
  | { type: "reset" };

export function createRefereeFeedState(): RefereeFeedState {
  return {
    items: {},
    order: [],
    reviewing: {},
    lastError: null,
    lastUpdatedAt: null,
  };
}

const SEVERITY_RANK: Record<AnalysisFindingSeverity, number> = {
  "possible-violation": 0,
  warning: 1,
  info: 2,
};

function severityRank(severity: AnalysisFindingSeverity): number {
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Total order over findings: severity (most serious first), then confidence
 * (highest first), then earliest turn, then `findingId` for a deterministic
 * tie-break. Pure — same input always yields the same order.
 */
export function compareFindings(a: AnalysisFinding, b: AnalysisFinding): number {
  const bySeverity = severityRank(a.severity) - severityRank(b.severity);
  if (bySeverity !== 0) {
    return bySeverity;
  }
  const byConfidence = b.confidence - a.confidence;
  if (byConfidence !== 0) {
    return byConfidence;
  }
  const byTurn = a.turnNumber - b.turnNumber;
  if (byTurn !== 0) {
    return byTurn;
  }
  return a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0;
}

function recomputeOrder(items: Record<string, FeedItem>): string[] {
  return Object.values(items)
    .map((item) => item.finding)
    .sort(compareFindings)
    .map((finding) => finding.findingId);
}

/**
 * Merges a freshly polled batch into the feed. Dedupe is by `findingId`:
 *  - a finding already present is updated in place (its finding + review are
 *    refreshed) while its local `acknowledged` flag is preserved;
 *  - a new finding is inserted;
 *  - a null/absent incoming review does NOT clobber an existing review (so an
 *    optimistic `reviewSuccess` survives until the server reflects it).
 * The render order is recomputed from scratch so severity ordering always holds.
 */
function mergeFindings(
  state: RefereeFeedState,
  incoming: IncomingFinding[],
  at: string | null,
): RefereeFeedState {
  const items: Record<string, FeedItem> = { ...state.items };
  for (const entry of incoming) {
    const id = entry.finding.findingId;
    const existing = items[id];
    const incomingReview = entry.review ?? null;
    items[id] = {
      finding: entry.finding,
      review: incomingReview ?? existing?.review ?? null,
      acknowledged: existing?.acknowledged ?? false,
    };
  }
  return {
    ...state,
    items,
    order: recomputeOrder(items),
    lastError: null,
    lastUpdatedAt: at ?? state.lastUpdatedAt,
  };
}

export function refereeFeedReducer(
  state: RefereeFeedState,
  action: RefereeFeedAction,
): RefereeFeedState {
  switch (action.type) {
    case "merge":
      return mergeFindings(state, action.findings, action.at ?? null);

    case "pollError":
      return { ...state, lastError: action.error };

    case "reviewStart":
      return {
        ...state,
        reviewing: { ...state.reviewing, [action.findingId]: true },
      };

    case "reviewSuccess": {
      const existing = state.items[action.findingId];
      const reviewing = { ...state.reviewing };
      delete reviewing[action.findingId];
      if (!existing) {
        // Review of a finding not (yet) in the feed — just clear the in-flight
        // marker; the next poll will bring the finding with its review.
        return { ...state, reviewing };
      }
      return {
        ...state,
        reviewing,
        items: {
          ...state.items,
          [action.findingId]: { ...existing, review: action.review },
        },
      };
    }

    case "reviewError": {
      const reviewing = { ...state.reviewing };
      delete reviewing[action.findingId];
      return { ...state, reviewing, lastError: action.error };
    }

    case "acknowledge": {
      const existing = state.items[action.findingId];
      if (!existing || existing.acknowledged) {
        return state;
      }
      return {
        ...state,
        items: {
          ...state.items,
          [action.findingId]: { ...existing, acknowledged: true },
        },
      };
    }

    case "reset":
      return createRefereeFeedState();

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Findings in render order — the list a referee view iterates over. */
export function orderedFeedItems(state: RefereeFeedState): FeedItem[] {
  return state.order.map((id) => state.items[id]).filter((item): item is FeedItem => Boolean(item));
}
