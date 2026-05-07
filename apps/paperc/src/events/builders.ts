import {
  backendEventBatchEnvelopeSchema,
  backendEventEnvelopeSchema,
  mediaIngestRequestSchema,
  type BackendEventBatchEnvelope,
  type BackendEventEnvelope,
  type MediaCaptureSession,
  type MediaIngestRequest,
  type PapercObservationPayload,
} from "../../../../packages/shared-schema/src/index";

export function buildPapercObservationEvent(
  input: BackendEventEnvelope,
): BackendEventEnvelope {
  return backendEventEnvelopeSchema.parse(input);
}

export function buildPapercEventBatch(
  input: BackendEventBatchEnvelope,
): BackendEventBatchEnvelope {
  return backendEventBatchEnvelopeSchema.parse(input);
}

export function buildPapercMediaRequest(
  captureSession: MediaCaptureSession,
  artifacts: MediaIngestRequest["artifacts"],
  idempotencyKey?: string,
): MediaIngestRequest {
  return mediaIngestRequestSchema.parse({
    idempotencyKey,
    captureSession,
    artifacts,
  });
}

export function buildPapercObservationPayload(
  input: PapercObservationPayload,
): PapercObservationPayload {
  return input;
}
