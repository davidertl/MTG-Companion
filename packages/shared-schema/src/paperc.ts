import { z } from "zod";

import type {
  BackendEventEnvelope,
  BackendEventSession,
  EventSourceApp,
} from "./events";
import { tournamentContextSchema } from "./tournaments";

export const papercEventTypeSchema = z.enum([
  "paperc.observation.detected",
  "paperc.review.requested",
  "paperc.review.resolved",
  "paperc.correction.applied",
  "paperc.match.finalized",
  "paperc.match.reopened",
]);

export const papercCaptureContextSchema = tournamentContextSchema.extend({
  captureSessionId: z.string().min(1),
  cameraId: z.string().min(1),
  videoSourceId: z.string().min(1).optional(),
});

export const papercSessionMetadataSchema = z.object({
  capture: papercCaptureContextSchema,
  calibrationId: z.string().min(1).optional(),
  reviewerRequiredByDefault: z.boolean().optional(),
  notes: z.string().min(1).optional(),
});

export const papercObservationPayloadSchema = papercCaptureContextSchema.extend({
  observationKind: z.enum([
    "board-state",
    "card-move",
    "score-change",
    "result-hint",
    "timer-state",
  ]),
  candidateRef: z.string().min(1).optional(),
  confidenceHint: z.number().min(0).max(1).optional(),
  frameRef: z
    .object({
      frameNo: z.number().int().nonnegative().optional(),
      frameTimeMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const papercReviewRequestedPayloadSchema = papercCaptureContextSchema.extend({
  reviewId: z.string().min(1),
  reasonCode: z.enum([
    "low-confidence",
    "conflict",
    "late-arrival",
    "manual-escalation",
  ]),
  targetEventId: z.string().min(1),
  summary: z.string().min(1).optional(),
});

export const papercReviewResolvedPayloadSchema = papercCaptureContextSchema.extend({
  reviewId: z.string().min(1),
  resolution: z.enum(["confirmed", "rejected", "corrected"]),
  targetEventId: z.string().min(1),
  correctedFields: z.record(z.string(), z.unknown()).default({}),
  note: z.string().min(1).optional(),
});

export const papercCorrectionAppliedPayloadSchema =
  papercCaptureContextSchema.extend({
    correctionId: z.string().min(1),
    targetEventId: z.string().min(1),
    correctedFields: z.record(z.string(), z.unknown()),
    reason: z.string().min(1),
  });

export const papercMatchFinalizedPayloadSchema = tournamentContextSchema.extend({
  finalizedBy: z.string().min(1),
  outcome: z.enum(["player1", "player2", "draw", "unknown"]),
  authoritativeEventId: z.string().min(1).optional(),
});

export const papercMatchReopenedPayloadSchema = tournamentContextSchema.extend({
  reopenedBy: z.string().min(1),
  reason: z.string().min(1),
  supersededFinalizationEventId: z.string().min(1),
});

const papercPayloadSchemas = {
  "paperc.observation.detected": papercObservationPayloadSchema,
  "paperc.review.requested": papercReviewRequestedPayloadSchema,
  "paperc.review.resolved": papercReviewResolvedPayloadSchema,
  "paperc.correction.applied": papercCorrectionAppliedPayloadSchema,
  "paperc.match.finalized": papercMatchFinalizedPayloadSchema,
  "paperc.match.reopened": papercMatchReopenedPayloadSchema,
} as const;

const allowedSourceAppsByEventType: Record<
  PapercEventType,
  EventSourceApp[]
> = {
  "paperc.observation.detected": ["mancutg-paperc"],
  "paperc.review.requested": ["mancutg-paperc", "mancutg-backend"],
  "paperc.review.resolved": ["mancutg-backend"],
  "paperc.correction.applied": ["mancutg-backend"],
  "paperc.match.finalized": ["mancutg-paperc", "mancutg-backend"],
  "paperc.match.reopened": ["mancutg-backend"],
};

export type PapercEventType = z.infer<typeof papercEventTypeSchema>;
export type PapercCaptureContext = z.infer<typeof papercCaptureContextSchema>;
export type PapercSessionMetadata = z.infer<typeof papercSessionMetadataSchema>;
export type PapercObservationPayload = z.infer<
  typeof papercObservationPayloadSchema
>;
export type PapercReviewRequestedPayload = z.infer<
  typeof papercReviewRequestedPayloadSchema
>;
export type PapercReviewResolvedPayload = z.infer<
  typeof papercReviewResolvedPayloadSchema
>;
export type PapercCorrectionAppliedPayload = z.infer<
  typeof papercCorrectionAppliedPayloadSchema
>;
export type PapercMatchFinalizedPayload = z.infer<
  typeof papercMatchFinalizedPayloadSchema
>;
export type PapercMatchReopenedPayload = z.infer<
  typeof papercMatchReopenedPayloadSchema
>;

export function validatePapercSessionContract(
  session: BackendEventSession,
): BackendEventSession {
  if (session.sourceApp !== "mancutg-paperc") {
    return session;
  }

  return {
    ...session,
    sourceKind: z.enum(["paper-camera", "manual-entry"]).parse(session.sourceKind),
    gameMode: z.literal("paper").parse(session.gameMode),
    streamId: z.string().min(1).parse(session.streamId),
    metadata: papercSessionMetadataSchema.parse(session.metadata),
  };
}

export function validatePapercEventContract(
  event: BackendEventEnvelope,
): BackendEventEnvelope {
  if (!papercEventTypeSchema.safeParse(event.eventType).success) {
    return event;
  }

  const eventType = event.eventType as PapercEventType;
  const allowedSourceApps = allowedSourceAppsByEventType[eventType];
  if (!allowedSourceApps.includes(event.sourceApp)) {
    throw new Error(
      `source app ${event.sourceApp} is not allowed to emit ${eventType}`,
    );
  }

  const payloadSchema = papercPayloadSchemas[eventType];
  const payload = payloadSchema.parse(event.payload);

  return {
    ...event,
    streamId: event.streamId ?? payload.tableId,
    matchId: event.matchId ?? payload.matchId,
    payload,
  };
}
