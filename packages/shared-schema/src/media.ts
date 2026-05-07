import { z } from "zod";

import { papercCaptureContextSchema } from "./paperc.ts";
import { tournamentContextSchema } from "./tournaments.ts";

export const mediaArtifactKindSchema = z.enum([
  "video",
  "clip",
  "frame-manifest",
]);

export const mediaCaptureSessionSchema = z.object({
  captureSessionId: z.string().min(1),
  sourceApp: z.literal("mancutg-paperc"),
  platform: z.string().min(1),
  cameraId: z.string().min(1),
  streamId: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).nullable().optional(),
  tournament: tournamentContextSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const mediaArtifactSchema = papercCaptureContextSchema.extend({
  artifactId: z.string().min(1),
  artifactKind: mediaArtifactKindSchema,
  uri: z.string().min(1),
  mimeType: z.string().min(1),
  sha256: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  capturedAt: z.string().min(1),
  frameStart: z.number().int().nonnegative().optional(),
  frameEnd: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const mediaIngestRequestSchema = z.object({
  idempotencyKey: z.string().min(1).optional(),
  captureSession: mediaCaptureSessionSchema,
  artifacts: z.array(mediaArtifactSchema).min(1),
});

export type MediaCaptureSession = z.infer<typeof mediaCaptureSessionSchema>;
export type MediaArtifact = z.infer<typeof mediaArtifactSchema>;
export type MediaIngestRequest = z.infer<typeof mediaIngestRequestSchema>;
