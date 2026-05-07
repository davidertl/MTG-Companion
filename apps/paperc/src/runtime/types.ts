import { z } from "zod";

import {
  papercFrameDetectionSchema,
  papercPlayerSchema,
  papercZoneSchema,
  tournamentContextSchema,
  type PapercFrameDetection,
  type PapercPlayer,
  type PapercZone,
} from "../../../../packages/shared-schema/src/index";

export const papercVideoSettingsSchema = z.object({
  sourceId: z.string().min(1),
  cameraId: z.string().min(1),
  fps: z.number().int().min(1).max(60).default(15),
  width: z.number().int().min(320).max(3840).default(1280),
  height: z.number().int().min(240).max(2160).default(720),
  rotateDeg: z.enum(["0", "90", "180", "270"]).default("0"),
});

export const papercRuntimeConfigSchema = z.object({
  captureSessionId: z.string().min(1),
  sourceSessionId: z.string().min(1),
  streamId: z.string().min(1),
  modelVersion: z.string().min(1),
  startedAt: z.string().min(1),
  tournament: tournamentContextSchema,
  video: papercVideoSettingsSchema,
  players: z.array(papercPlayerSchema).min(2),
  zones: z.array(papercZoneSchema).min(1),
});

export const papercFrameInputSchema = z.object({
  frameNo: z.number().int().nonnegative(),
  frameTimeMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rawDetections: z
    .array(
      z.object({
        zoneId: z.string().min(1),
        label: z.string().min(1),
        confidence: z.number().min(0).max(1),
        count: z.number().int().positive().default(1),
      }),
    )
    .default([]),
});

export const papercRecognitionSnapshotSchema = z.object({
  frameNo: z.number().int().nonnegative(),
  frameTimeMs: z.number().int().nonnegative(),
  detections: z.array(papercFrameDetectionSchema),
  droppedFrame: z.boolean().default(false),
  latencyMs: z.number().int().nonnegative(),
});

export type PapercVideoSettings = z.infer<typeof papercVideoSettingsSchema>;
export type PapercRuntimeConfig = z.infer<typeof papercRuntimeConfigSchema>;
export type PapercFrameInput = z.infer<typeof papercFrameInputSchema>;
export type PapercRecognitionSnapshot = z.infer<typeof papercRecognitionSnapshotSchema>;
export type { PapercFrameDetection, PapercPlayer, PapercZone };
