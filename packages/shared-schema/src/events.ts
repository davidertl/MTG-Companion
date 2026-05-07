import { z } from "zod";

export const eventSourceAppSchema = z.enum([
  "mancutg-arenac",
  "mancutg-paperc",
  "mancutg-backend",
]);

export const eventSourceKindSchema = z.enum([
  "arena-log",
  "arena-ios-log",
  "paper-camera",
  "manual-entry",
  "backend-process",
  "review-decision",
]);

export const reviewStatusSchema = z.enum([
  "none",
  "pending",
  "confirmed",
  "rejected",
  "corrected",
]);

export const backendEventDeviceSchema = z.object({
  deviceId: z.string().min(1),
  os: z.string().min(1).optional(),
  hostnameHash: z.string().min(1).optional(),
});

export const backendEventSourceArtifactSchema = z.object({
  sourceArtifactId: z.string().min(1),
  logicalType: z.string().min(1),
  pathHint: z.string().min(1).optional(),
  fileSha256: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  capturedAt: z.string().min(1).optional(),
});

export const backendEventSessionPrivacySchema = z.object({
  syncEnabled: z.boolean().optional(),
  telemetryOptIn: z.boolean().optional(),
  rawUploadEnabled: z.boolean().optional(),
});

export const backendEventSessionSchema = z.object({
  sourceSessionId: z.string().min(1),
  sourceApp: eventSourceAppSchema,
  sourceKind: eventSourceKindSchema,
  platform: z.string().min(1),
  gameFamily: z.literal("mtg").default("mtg"),
  gameMode: z.enum(["arena", "paper", "service"]),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).nullable().optional(),
  parserVersion: z.string().min(1).optional(),
  clientVersion: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  device: backendEventDeviceSchema.optional(),
  sources: z.array(backendEventSourceArtifactSchema).default([]),
  privacy: backendEventSessionPrivacySchema.optional(),
});

export const backendEventActorSchema = z.object({
  playerRef: z.string().min(1).optional(),
  teamRef: z.string().min(1).optional(),
  seatRef: z.string().min(1).optional(),
});

export const backendEventCardRefSchema = z.object({
  oracleId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export const backendEventObjectSchema = z.object({
  objectRef: z.string().min(1).optional(),
  objectKind: z.string().min(1),
  cardRef: backendEventCardRefSchema.optional(),
  quantity: z.number().int().positive().optional(),
  tags: z.array(z.string()).default([]),
});

export const backendEventTargetSchema = z.object({
  playerRef: z.string().min(1).optional(),
  objectRef: z.string().min(1).optional(),
  zoneRef: z.string().min(1).optional(),
});

export const backendEventProvenanceSchema = z.object({
  sourceKind: eventSourceKindSchema,
  sourceSessionId: z.string().min(1),
  sourceArtifactId: z.string().min(1).optional(),
  rawFragmentHash: z.string().min(1).optional(),
  byteOffsetStart: z.number().int().nonnegative().optional(),
  byteOffsetEnd: z.number().int().nonnegative().optional(),
  frameNo: z.number().int().nonnegative().optional(),
  frameTimeMs: z.number().int().nonnegative().optional(),
  cameraId: z.string().min(1).optional(),
  modelVersion: z.string().min(1).optional(),
  parserVersion: z.string().min(1).optional(),
});

export const backendEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  sourceApp: eventSourceAppSchema,
  sourceSessionId: z.string().min(1),
  eventType: z.string().min(1),
  occurredAt: z.string().min(1),
  matchId: z.string().min(1).optional(),
  gameId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  seq: z.number().int().nonnegative().optional(),
  actor: backendEventActorSchema.optional(),
  object: backendEventObjectSchema.optional(),
  objects: z.array(backendEventObjectSchema).optional(),
  fromZone: z.string().min(1).optional(),
  toZone: z.string().min(1).optional(),
  targets: z.array(backendEventTargetSchema).default([]),
  provenance: z.array(backendEventProvenanceSchema).min(1),
  confidence: z.number().min(0).max(1).default(1),
  reviewStatus: reviewStatusSchema.default("none"),
  supersedesEventId: z.string().min(1).nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const backendEventBatchEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(1).optional(),
  sessions: z.array(backendEventSessionSchema).default([]),
  events: z.array(backendEventEnvelopeSchema).min(1),
});

export type EventSourceApp = z.infer<typeof eventSourceAppSchema>;
export type EventSourceKind = z.infer<typeof eventSourceKindSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type BackendEventSession = z.infer<typeof backendEventSessionSchema>;
export type BackendEventEnvelope = z.infer<typeof backendEventEnvelopeSchema>;
export type BackendEventBatchEnvelope = z.infer<typeof backendEventBatchEnvelopeSchema>;
