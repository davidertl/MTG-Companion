import {
  buildHistoryRouteState,
  type MatchHistoryRecord,
} from "../../lib/query/history";
import type {
  RustCardDbStatus,
  RustFinding,
  RustGameTimeline,
  RustObjectState,
  RustPlayerZones,
  RustTimelineAction,
  RustTurnSnapshot,
} from "../../lib/tauri/commands";

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

// ---------------------------------------------------------------------------
// Analysis view models (W4.1)
//
// The desktop match-detail surface renders three pure view models, all built
// here so the `MatchDetail` component stays render-only:
//   - `buildTimelineViewModel`  — the per-turn game timeline with findings
//                                  markers placed inline at their turn;
//   - `buildFindingsViewModel`  — findings split into rule-checks and
//                                  suggestions with non-overclaiming labels;
//   - `buildCardDbStatusView`   — the offline card-DB status / import guidance.
// `buildMatchAnalysisState` composes them into the single state the component
// consumes.
// ---------------------------------------------------------------------------

/** Human-readable, deliberately non-overclaiming severity labels. */
const SEVERITY_LABELS: Record<RustFinding["severity"], string> = {
  info: "Info",
  warning: "Warning",
  // Never a verdict ("cheated"/"illegal") — the engine only ever hints.
  "possible-violation": "Possible rule-break",
};

const KIND_LABELS: Record<RustFinding["kind"], string> = {
  "rule-check": "Rule check",
  suggestion: "Suggestion",
};

export interface FindingMarkerView {
  findingId: string;
  code: string;
  kind: RustFinding["kind"];
  kindLabel: string;
  severity: RustFinding["severity"];
  severityLabel: string;
  turnNumber: number;
  phase: string;
  /** Raw confidence in the 0..1 range, shown verbatim. */
  confidence: number;
  /** Confidence as an integer percentage for compact display. */
  confidencePercent: number;
  /** "Confidence 0.62 (62%)" — the raw value is always shown verbatim. */
  confidenceLabel: string;
  ruleRefs: string[];
  /** Joined CR citations shown verbatim, e.g. "CR 305.2, CR 117.1a". */
  ruleRefsLabel: string;
  description: string;
  audience: RustFinding["audience"];
}

function toFindingMarker(finding: RustFinding): FindingMarkerView {
  const confidencePercent = Math.round(finding.confidence * 100);
  return {
    findingId: finding.findingId,
    code: finding.code,
    kind: finding.kind,
    kindLabel: KIND_LABELS[finding.kind] ?? finding.kind,
    severity: finding.severity,
    severityLabel: SEVERITY_LABELS[finding.severity] ?? finding.severity,
    turnNumber: finding.turnNumber,
    phase: finding.phase,
    confidence: finding.confidence,
    confidencePercent,
    confidenceLabel: `Confidence ${finding.confidence} (${confidencePercent}%)`,
    ruleRefs: [...finding.ruleRefs],
    ruleRefsLabel: finding.ruleRefs.join(", "),
    description: finding.description,
    audience: finding.audience,
  };
}

/** Deterministic ordering: earliest turn first, then code, then id. */
function compareFindings(a: FindingMarkerView, b: FindingMarkerView): number {
  if (a.turnNumber !== b.turnNumber) {
    return a.turnNumber - b.turnNumber;
  }
  if (a.code !== b.code) {
    return a.code.localeCompare(b.code);
  }
  return a.findingId.localeCompare(b.findingId);
}

export interface FindingsViewModel {
  /** All findings, deterministically ordered. */
  all: FindingMarkerView[];
  /** `kind: 'rule-check'` findings — rendered as inline timeline markers. */
  ruleFindings: FindingMarkerView[];
  /** `kind: 'suggestion'` findings — rendered in the suggestions panel. */
  suggestions: FindingMarkerView[];
  empty: boolean;
}

/**
 * Splits the analysis findings into rule-checks (inline timeline markers) and
 * suggestions (their own panel), each deterministically ordered.
 */
export function buildFindingsViewModel(findings: RustFinding[]): FindingsViewModel {
  const all = findings.map(toFindingMarker).sort(compareFindings);
  return {
    all,
    ruleFindings: all.filter((finding) => finding.kind === "rule-check"),
    suggestions: all.filter((finding) => finding.kind === "suggestion"),
    empty: all.length === 0,
  };
}

export interface TimelinePlayerView {
  player: string;
  life: number;
  handCount: number;
  libraryCount: number;
  battlefieldCount: number;
  graveyardCount: number;
  exileCount: number;
  /** Best-effort card labels on the battlefield (names when known). */
  battlefield: string[];
}

export interface TimelineActionView {
  label: string;
}

export interface TimelineTurnView {
  turnNumber: number;
  activePlayer: string | null;
  phase: string | null;
  step: string | null;
  players: TimelinePlayerView[];
  actions: TimelineActionView[];
  /** Rule-check findings whose `turnNumber` lands on this turn. */
  findings: FindingMarkerView[];
}

export interface TimelineViewModel {
  turns: TimelineTurnView[];
  partial: boolean;
  partialReason: string | null;
  notes: string[];
  empty: boolean;
  /** Rule findings whose turn number matches no reconstructed turn. */
  unplacedFindings: FindingMarkerView[];
}

function cardRefLabel(object: RustObjectState): string {
  const ref = object.cardRef ?? {};
  if (ref.name && ref.name.length > 0) {
    return ref.name;
  }
  if (typeof ref.arenaId === "number") {
    return `Arena #${ref.arenaId}`;
  }
  if (ref.scryfallOracleId) {
    return ref.scryfallOracleId;
  }
  if (typeof object.instanceId === "number") {
    return `Unknown #${object.instanceId}`;
  }
  return "Unknown card";
}

function toPlayerViews(
  zones: Record<string, RustPlayerZones>,
  lifeTotals: Record<string, number>,
): TimelinePlayerView[] {
  const players = new Set<string>([
    ...Object.keys(zones ?? {}),
    ...Object.keys(lifeTotals ?? {}),
  ]);
  return [...players]
    .sort((a, b) => a.localeCompare(b))
    .map((player) => {
      const zone: RustPlayerZones | undefined = zones?.[player];
      return {
        player,
        life: lifeTotals?.[player] ?? 0,
        handCount: zone?.handCount ?? 0,
        libraryCount: zone?.libraryCount ?? 0,
        battlefieldCount: zone?.battlefield.length ?? 0,
        graveyardCount: zone?.graveyard.length ?? 0,
        exileCount: zone?.exile.length ?? 0,
        battlefield: (zone?.battlefield ?? []).map(cardRefLabel),
      };
    });
}

function actionLabel(action: RustTimelineAction): string {
  if (action.source === "raw") {
    return action.note && action.note.length > 0 ? action.note : action.eventType;
  }
  // Parsed actions carry an open payload; surface the most descriptive field
  // available without asserting a specific gameplay shape.
  const record = action as Record<string, unknown>;
  const candidate =
    record.kind ?? record.action ?? record.eventType ?? record.type ?? record.label;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  return "action";
}

function toTurnView(
  snapshot: RustTurnSnapshot,
  findingsByTurn: Map<number, FindingMarkerView[]>,
): TimelineTurnView {
  return {
    turnNumber: snapshot.turnNumber,
    activePlayer: snapshot.activePlayer ?? null,
    phase: snapshot.phase ?? null,
    step: snapshot.step ?? null,
    players: toPlayerViews(snapshot.zones ?? {}, snapshot.lifeTotals ?? {}),
    actions: (snapshot.actions ?? []).map((action) => ({ label: actionLabel(action) })),
    findings: findingsByTurn.get(snapshot.turnNumber) ?? [],
  };
}

/**
 * Builds the per-turn timeline view model and places rule-check findings inline
 * on their matching turn. Suggestions are intentionally excluded from the
 * timeline (they live in the suggestions panel). Findings whose turn matches no
 * reconstructed turn are returned in `unplacedFindings` so they are never lost.
 */
export function buildTimelineViewModel(
  timeline: RustGameTimeline,
  findings: RustFinding[] = [],
): TimelineViewModel {
  const markers = buildFindingsViewModel(findings).ruleFindings;
  const turnNumbers = new Set(timeline.turns.map((turn) => turn.turnNumber));

  const findingsByTurn = new Map<number, FindingMarkerView[]>();
  const unplacedFindings: FindingMarkerView[] = [];
  for (const marker of markers) {
    if (turnNumbers.has(marker.turnNumber)) {
      const bucket = findingsByTurn.get(marker.turnNumber) ?? [];
      bucket.push(marker);
      findingsByTurn.set(marker.turnNumber, bucket);
    } else {
      unplacedFindings.push(marker);
    }
  }

  const partial = timeline.completeness.kind === "partial";
  return {
    turns: timeline.turns.map((snapshot) => toTurnView(snapshot, findingsByTurn)),
    partial,
    partialReason:
      timeline.completeness.kind === "partial" ? timeline.completeness.reason : null,
    notes: [...timeline.notes],
    empty: timeline.turns.length === 0,
    unplacedFindings,
  };
}

export interface CardDbStatusView {
  imported: boolean;
  cardCount: number;
  withArenaIdCount: number;
  /** Compact one-line status, e.g. "12345 cards (3210 with Arena id)". */
  label: string;
  /** Offline import guidance shown when no card DB is present. */
  guidance: string | null;
}

/** CLI guidance surfaced whenever the local card DB is missing. Offline only. */
export const CARD_DB_IMPORT_GUIDANCE =
  "No card database imported. Run `mancutg-arenac import-card-db <path-to-scryfall-bulk.json>` " +
  "to enable full offline analysis. Download the Scryfall bulk data manually — nothing is fetched automatically.";

/**
 * Pure view model for the offline card-DB status. When no DB is imported the
 * view carries the `import-card-db` CLI guidance so both the settings panel and
 * the match-detail empty state can render it.
 */
export function buildCardDbStatusView(
  status: Pick<RustCardDbStatus, "cardDbExists" | "cardCount" | "withArenaIdCount"> | null,
): CardDbStatusView {
  if (!status || !status.cardDbExists) {
    return {
      imported: false,
      cardCount: 0,
      withArenaIdCount: 0,
      label: "Not imported",
      guidance: CARD_DB_IMPORT_GUIDANCE,
    };
  }
  return {
    imported: true,
    cardCount: status.cardCount,
    withArenaIdCount: status.withArenaIdCount,
    label: `${status.cardCount} cards (${status.withArenaIdCount} with Arena id)`,
    guidance: null,
  };
}

export interface MatchAnalysisState {
  matchId: string;
  timeline: TimelineViewModel;
  findings: FindingsViewModel;
  cardDb: CardDbStatusView;
  /** True once an analysis run has been persisted for this match. */
  analysisRun: boolean;
}

/**
 * Composes the timeline, findings, and card-DB view models into the single
 * state consumed by the `MatchDetail` analysis surface.
 */
export function buildMatchAnalysisState(input: {
  matchId: string;
  timeline: RustGameTimeline;
  findings?: RustFinding[];
  cardDb: Pick<RustCardDbStatus, "cardDbExists" | "cardCount" | "withArenaIdCount"> | null;
  analysisRun?: boolean;
}): MatchAnalysisState {
  const findings = input.findings ?? [];
  return {
    matchId: input.matchId,
    timeline: buildTimelineViewModel(input.timeline, findings),
    findings: buildFindingsViewModel(findings),
    cardDb: buildCardDbStatusView(input.cardDb),
    analysisRun: input.analysisRun ?? false,
  };
}
