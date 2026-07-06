/**
 * Referee dashboard transport (plan 2026-07-06-001 W4.2).
 *
 * Thin HTTP client for the tournament findings API (W3.3):
 *  - GET  /tournaments/:id/findings           — poll the visible feed
 *  - POST /tournaments/:id/findings/:id/review — acknowledge/resolve a finding
 *
 * Both require a bearer token (the referee pastes one obtained from the backend
 * via /auth/register). The transport is intentionally separate from the pure
 * feed reducer (src/state/refereeFeed.ts) and from the polling loop (which lives
 * in RefereeView.tsx) so a later server-push upgrade only touches the wiring.
 */

import type {
  AnalysisFinding,
  FindingVisibilityMode,
} from "../../../../packages/shared-schema/src/index";
import type { FeedReview, ReviewResolution } from "../state/refereeFeed";

/** Server shape of `GET /tournaments/:id/findings`. */
export interface ListFindingsResponse {
  tournamentId: string;
  findingVisibilityMode: FindingVisibilityMode;
  findings: Array<{ finding: AnalysisFinding; review: FeedReview | null }>;
}

/** Server shape of `POST /tournaments/:id/findings/:findingId/review`. */
export interface ReviewFindingResponse {
  review: {
    tournamentId: string;
    findingId: string;
    gameKey: string;
    resolution: ReviewResolution;
    reviewedBy: string;
    note?: string;
  };
  duplicate: boolean;
}

export type JsonFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RefereeApiConfig {
  endpoint: string;
  token: string;
  fetchFn?: JsonFetch;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function authHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

const defaultFetch: JsonFetch = (url, init) =>
  fetch(url, init).then((response) => ({
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  }));

async function requestJson<T>(
  config: RefereeApiConfig,
  path: string,
  init: { method: string; body?: string },
): Promise<T> {
  const fetchFn = config.fetchFn ?? defaultFetch;
  const response = await fetchFn(`${normalizeEndpoint(config.endpoint)}${path}`, {
    method: init.method,
    headers: authHeaders(config.token),
    body: init.body,
  });
  if (!response.ok) {
    throw new Error(`request failed: http ${response.status}`);
  }
  return (await response.json()) as T;
}

export function listFindings(
  config: RefereeApiConfig,
  tournamentId: string,
): Promise<ListFindingsResponse> {
  return requestJson<ListFindingsResponse>(
    config,
    `/tournaments/${encodeURIComponent(tournamentId)}/findings`,
    { method: "GET" },
  );
}

export function reviewFinding(
  config: RefereeApiConfig,
  tournamentId: string,
  findingId: string,
  resolution: ReviewResolution,
  note?: string,
): Promise<ReviewFindingResponse> {
  return requestJson<ReviewFindingResponse>(
    config,
    `/tournaments/${encodeURIComponent(tournamentId)}/findings/${encodeURIComponent(findingId)}/review`,
    {
      method: "POST",
      body: JSON.stringify(note ? { resolution, note } : { resolution }),
    },
  );
}
