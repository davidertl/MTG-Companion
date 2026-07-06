import {
  buildHistoryRouteState,
  type MatchHistoryRecord,
} from "../../lib/query/history";

export function getHistoryRouteState(matches: MatchHistoryRecord[]) {
  return buildHistoryRouteState(matches);
}

/**
 * One stored event as delivered by the `inspect_match` Tauri command
 * (`RustMatchEventSummary`). Kept structurally identical so the raw command
 * output feeds the pure builder directly.
 */
export interface MatchEventInput {
  sessionId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  payloadJson: string;
}

export interface MatchTimelineEntry {
  sequence: number;
  timestamp: string;
  eventType: string;
  /** Human-readable one-line summary of the payload (match_id omitted). */
  summary: string;
}

export interface MatchDetailState {
  matchId: string;
  empty: boolean;
  eventCount: number;
  timeline: MatchTimelineEntry[];
}

function summarizePayload(payloadJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return payloadJson;
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
    .filter(([key]) => key !== "match_id")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return entries.length > 0 ? entries.join(", ") : "(no payload fields)";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Pure view-model builder for the per-match event timeline. Consumes the
 * `inspect_match` command output; the `MatchDetail` component only renders it.
 */
export function buildMatchDetailState(
  matchId: string,
  events: MatchEventInput[],
): MatchDetailState {
  const timeline = events.map((event) => ({
    sequence: event.sequence,
    timestamp: event.timestamp,
    eventType: event.eventType,
    summary: summarizePayload(event.payloadJson),
  }));

  return {
    matchId,
    empty: timeline.length === 0,
    eventCount: timeline.length,
    timeline,
  };
}
