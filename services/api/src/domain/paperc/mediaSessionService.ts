import {
  mediaCaptureSessionSchema,
  mediaIngestRequestSchema,
  type MediaArtifact,
} from "../../../../../packages/shared-schema/src/index.ts";
import { upsertMediaState, type EventStore } from "../eventService.ts";

export interface MediaIngestResult {
  captureSessionId: string;
  createdSession: boolean;
  acceptedArtifactCount: number;
  duplicateArtifactCount: number;
  duplicateBatch: boolean;
  totalStoredMediaSessions: number;
  totalStoredMediaArtifacts: number;
  artifactKinds: Array<MediaArtifact["artifactKind"]>;
}

export function ingestMediaSession(
  store: EventStore,
  input: unknown,
): MediaIngestResult {
  const payload = mediaIngestRequestSchema.parse(input);
  const captureSession = mediaCaptureSessionSchema.parse(payload.captureSession);
  const result = upsertMediaState(
    store,
    captureSession,
    payload.artifacts,
    payload.idempotencyKey,
  );

  return {
    captureSessionId: captureSession.captureSessionId,
    createdSession: result.createdSession,
    acceptedArtifactCount: result.acceptedArtifactCount,
    duplicateArtifactCount: result.duplicateArtifactCount,
    duplicateBatch: result.duplicateBatch,
    totalStoredMediaSessions: result.totalStoredMediaSessions,
    totalStoredMediaArtifacts: result.totalStoredMediaArtifacts,
    artifactKinds: [...new Set(payload.artifacts.map((artifact) => artifact.artifactKind))],
  };
}
