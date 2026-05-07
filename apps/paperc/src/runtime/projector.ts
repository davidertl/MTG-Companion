import type {
  BackendEventBatchEnvelope,
  BackendEventEnvelope,
  BackendEventSession,
} from "../../../../packages/shared-schema/src/index";
import { buildPapercEventBatch, buildPapercObservationPayload } from "../events/builders";
import type { PapercRecognitionSnapshot, PapercRuntimeConfig } from "./types";

export function occurredAtFromFrame(sessionStartedAt: string, frameTimeMs: number): string {
  const startedAtMs = new Date(sessionStartedAt).getTime();
  return new Date(startedAtMs + frameTimeMs).toISOString();
}

export function buildPapercSession(config: PapercRuntimeConfig): BackendEventSession {
  return {
    sourceSessionId: config.sourceSessionId,
    sourceApp: "mancutg-paperc",
    sourceKind: "paper-camera",
    platform: "webcam-live",
    gameFamily: "mtg",
    gameMode: "paper",
    startedAt: config.startedAt,
    streamId: config.streamId,
    sources: [],
    metadata: {
      capture: {
        ...config.tournament,
        captureSessionId: config.captureSessionId,
        cameraId: config.video.cameraId,
        videoSourceId: config.video.sourceId,
      },
      players: config.players,
      zones: config.zones,
    },
  };
}

export function snapshotToEvents(
  config: PapercRuntimeConfig,
  snapshot: PapercRecognitionSnapshot,
): BackendEventEnvelope[] {
  return snapshot.detections.map((detection, index) => ({
    eventId: `${config.captureSessionId}-obs-${snapshot.frameNo}-${index}`,
    sourceApp: "mancutg-paperc",
    sourceSessionId: config.sourceSessionId,
    eventType: "paperc.observation.detected",
    occurredAt: occurredAtFromFrame(config.startedAt, detection.frameTimeMs),
    streamId: config.streamId,
    matchId: config.tournament.matchId,
    seq: snapshot.frameNo * 100 + index,
    targets: [],
    object: {
      objectKind: "card",
      cardRef: {
        name: detection.candidateName,
      },
      quantity: detection.cardCount,
      tags: [detection.zoneId],
    },
    provenance: [
      {
        sourceKind: "paper-camera",
        sourceSessionId: config.sourceSessionId,
        frameNo: detection.frameNo,
        frameTimeMs: detection.frameTimeMs,
        cameraId: config.video.cameraId,
        modelVersion: config.modelVersion,
      },
    ],
    confidence: detection.confidence,
    reviewStatus: "none",
    supersedesEventId: null,
    payload: buildPapercObservationPayload({
      ...config.tournament,
      captureSessionId: config.captureSessionId,
      cameraId: config.video.cameraId,
      videoSourceId: config.video.sourceId,
      observationKind: "board-state",
      frameRef: {
        frameNo: detection.frameNo,
        frameTimeMs: detection.frameTimeMs,
      },
      detections: [detection],
      details: {
        zoneId: detection.zoneId,
      },
    }),
  }));
}

export function buildPapercEventBatchFromSnapshot(
  config: PapercRuntimeConfig,
  snapshot: PapercRecognitionSnapshot,
): BackendEventBatchEnvelope | null {
  const events = snapshotToEvents(config, snapshot);
  if (events.length === 0) {
    return null;
  }
  return buildPapercEventBatch({
    idempotencyKey: `${config.captureSessionId}-frame-${snapshot.frameNo}`,
    sessions: [buildPapercSession(config)],
    events,
  });
}
