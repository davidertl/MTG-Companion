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

export const ingestProducerSchema = z.object({
  app: eventSourceAppSchema,
  version: z.string().min(1),
  instanceId: z.string().min(1),
  displayName: z.string().min(1).optional(),
});

export const ingestGameSchema = z.object({
  gameKey: z.string().min(1),
  gameFamily: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["arena", "paper", "service"]),
});

export const ingestSessionSchema = z.object({
  sourceSessionId: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  source: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ingestEventProvenanceSchema = z.object({
  source: z.string().min(1),
  lineNumber: z.number().int().nonnegative().optional(),
  frameNo: z.number().int().nonnegative().optional(),
  frameTimeMs: z.number().int().nonnegative().optional(),
  parserVersion: z.string().min(1).optional(),
  modelVersion: z.string().min(1).optional(),
  artifactId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ingestEventSchema = z.object({
  eventId: z.string().min(1),
  sourceEventId: z.string().min(1),
  eventType: z.string().min(1),
  occurredAt: z.string().min(1),
  seq: z.number().int().nonnegative().optional(),
  actor: z.record(z.string(), z.unknown()).optional(),
  object: z.record(z.string(), z.unknown()).optional(),
  targets: z.array(z.record(z.string(), z.unknown())).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
  provenance: ingestEventProvenanceSchema,
});

export const ingestBatchRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  producer: ingestProducerSchema,
  game: ingestGameSchema,
  session: ingestSessionSchema,
  events: z.array(ingestEventSchema).min(1),
});

export const ingestBatchErrorSchema = z.object({
  eventId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ingestBatchResponseSchema = z.object({
  batchId: z.string().min(1),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.array(ingestBatchErrorSchema).default([]),
});

export type EventSourceApp = z.infer<typeof eventSourceAppSchema>;
export type EventSourceKind = z.infer<typeof eventSourceKindSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type BackendEventSession = z.infer<typeof backendEventSessionSchema>;
export type BackendEventEnvelope = z.infer<typeof backendEventEnvelopeSchema>;
export type BackendEventBatchEnvelope = z.infer<typeof backendEventBatchEnvelopeSchema>;
export type IngestProducer = z.infer<typeof ingestProducerSchema>;
export type IngestGame = z.infer<typeof ingestGameSchema>;
export type IngestSession = z.infer<typeof ingestSessionSchema>;
export type IngestEventProvenance = z.infer<typeof ingestEventProvenanceSchema>;
export type IngestEvent = z.infer<typeof ingestEventSchema>;
export type IngestBatchRequest = z.infer<typeof ingestBatchRequestSchema>;
export type IngestBatchError = z.infer<typeof ingestBatchErrorSchema>;
export type IngestBatchResponse = z.infer<typeof ingestBatchResponseSchema>;
