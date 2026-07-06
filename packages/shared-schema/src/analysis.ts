import { z } from "zod";

import type { BackendEventEnvelope, EventSourceApp } from "./events.ts";
import { gameKeySchema } from "./tournaments.ts";

/**
 * Analysis finding/suggestion contracts (plan 2026-07-06-001, unit W0.1).
 *
 * Findings are hints for a human reviewer — never verdicts or autonomous
 * rulings. `code` is deliberately an open string: the registry of known
 * codes lives with the engines (e.g. `extra-land-drop`, `timing-violation`,
 * `sba-lethal-damage`, `mana-impossible`, `illegal-attack`,
 * `missed-trigger-hint`, `lethal-available`, `unused-mana-with-play`,
 * `missed-land-drop`, `no-block-lethal-taken`); unknown codes must still
 * parse so newer engines interoperate with older clients.
 */

export const analysisFindingKindSchema = z.enum(["rule-check", "suggestion"]);

export const analysisFindingSeveritySchema = z.enum([
  "info",
  "warning",
  "possible-violation",
]);

export const analysisAudienceSchema = z.enum([
  "players",
  "referee-only",
  "all",
]);

export const analysisFindingSchema = z.object({
  findingId: z.string().min(1),
  gameKey: gameKeySchema,
  turnNumber: z.number().int().nonnegative(),
  phase: z.string().min(1),
  kind: analysisFindingKindSchema,
  code: z.string().min(1),
  severity: analysisFindingSeveritySchema,
  confidence: z.number().min(0).max(1),
  ruleRefs: z.array(z.string().min(1)).default([]),
  description: z.string().min(1),
  audience: analysisAudienceSchema.default("players"),
  engineVersion: z.string().min(1),
});

export const ANALYSIS_FINDING_RAISED_EVENT_TYPE =
  "analysis.finding.raised" as const;
export const ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE =
  "analysis.suggestion.raised" as const;
export const ANALYSIS_FINDING_REVIEWED_EVENT_TYPE =
  "analysis.finding.reviewed" as const;

export const analysisEventTypeSchema = z.enum([
  ANALYSIS_FINDING_RAISED_EVENT_TYPE,
  ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
  ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
]);

export const analysisFindingRaisedPayloadSchema = analysisFindingSchema.extend({
  kind: z.literal("rule-check"),
});

export const analysisSuggestionRaisedPayloadSchema =
  analysisFindingSchema.extend({
    kind: z.literal("suggestion"),
  });

export const analysisFindingReviewedPayloadSchema = z.object({
  findingId: z.string().min(1),
  gameKey: gameKeySchema,
  resolution: z.enum(["confirmed", "dismissed", "corrected"]),
  reviewedBy: z.string().min(1),
  note: z.string().min(1).optional(),
});

const analysisPayloadSchemas = {
  [ANALYSIS_FINDING_RAISED_EVENT_TYPE]: analysisFindingRaisedPayloadSchema,
  [ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE]: analysisSuggestionRaisedPayloadSchema,
  [ANALYSIS_FINDING_REVIEWED_EVENT_TYPE]: analysisFindingReviewedPayloadSchema,
} as const;

/**
 * Only the local analysis engine (running inside the desktop app) or the
 * backend may emit `analysis.*` events — PaperC clients consume findings
 * but never produce them.
 */
const allowedSourceAppsByEventType: Record<AnalysisEventType, EventSourceApp[]> = {
  [ANALYSIS_FINDING_RAISED_EVENT_TYPE]: ["mancutg-arenac", "mancutg-backend"],
  [ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE]: [
    "mancutg-arenac",
    "mancutg-backend",
  ],
  [ANALYSIS_FINDING_REVIEWED_EVENT_TYPE]: [
    "mancutg-arenac",
    "mancutg-backend",
  ],
};

export type AnalysisFindingKind = z.infer<typeof analysisFindingKindSchema>;
export type AnalysisFindingSeverity = z.infer<
  typeof analysisFindingSeveritySchema
>;
export type AnalysisAudience = z.infer<typeof analysisAudienceSchema>;
export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;
export type AnalysisEventType = z.infer<typeof analysisEventTypeSchema>;
export type AnalysisFindingRaisedPayload = z.infer<
  typeof analysisFindingRaisedPayloadSchema
>;
export type AnalysisSuggestionRaisedPayload = z.infer<
  typeof analysisSuggestionRaisedPayloadSchema
>;
export type AnalysisFindingReviewedPayload = z.infer<
  typeof analysisFindingReviewedPayloadSchema
>;

export function validateAnalysisEventContract(
  event: BackendEventEnvelope,
): BackendEventEnvelope {
  if (!analysisEventTypeSchema.safeParse(event.eventType).success) {
    return event;
  }

  const eventType = event.eventType as AnalysisEventType;
  const allowedSourceApps = allowedSourceAppsByEventType[eventType];
  if (!allowedSourceApps.includes(event.sourceApp)) {
    throw new Error(
      `source app ${event.sourceApp} is not allowed to emit ${eventType}`,
    );
  }

  const payloadSchema = analysisPayloadSchemas[eventType];
  const payload = payloadSchema.parse(event.payload);

  return {
    ...event,
    payload,
  };
}
