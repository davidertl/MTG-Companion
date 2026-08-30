import { mediaIngestRequestSchema } from "../../../../../packages/shared-schema/src/index.ts";
import type { BackendStoreLike } from "../../domain/eventService.ts";
import { ingestMediaSession } from "../../domain/paperc/mediaSessionService.ts";

export interface MediaIngestRouteResult {
  captureSessionId: string;
  createdSession: boolean;
  acceptedArtifactCount: number;
  duplicateArtifactCount: number;
  duplicateBatch: boolean;
  totalStoredMediaSessions: number;
  totalStoredMediaArtifacts: number;
}

export function mediaSessionsRoute(
  input: unknown,
  store: BackendStoreLike,
): MediaIngestRouteResult {
  const request = mediaIngestRequestSchema.parse(input);
  const result = ingestMediaSession(store, request);

  return {
    captureSessionId: request.captureSession.captureSessionId,
    createdSession: result.createdSession,
    acceptedArtifactCount: result.acceptedArtifactCount,
    duplicateArtifactCount: result.duplicateArtifactCount,
    duplicateBatch: result.duplicateBatch,
    totalStoredMediaSessions: result.totalStoredMediaSessions,
    totalStoredMediaArtifacts: result.totalStoredMediaArtifacts,
  };
}
