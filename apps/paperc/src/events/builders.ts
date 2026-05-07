import { z } from "zod";

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
import {
  validatePapercEventContract,
  validatePapercSessionContract,
} from "../../../../packages/shared-schema/src/paperc";

export function buildPapercObservationEvent(
  input: z.input<typeof backendEventEnvelopeSchema>,
): BackendEventEnvelope {
  return backendEventEnvelopeSchema.parse(input);
}

export function buildPapercEventBatch(
  input: z.input<typeof backendEventBatchEnvelopeSchema>,
): BackendEventBatchEnvelope {
  const parsed = backendEventBatchEnvelopeSchema.parse(input);
  return {
    ...parsed,
    sessions: parsed.sessions.map((session) => validatePapercSessionContract(session)),
    events: parsed.events.map((event) => validatePapercEventContract(event)),
  };
}

export function buildPapercMediaRequest(
  captureSession: z.input<typeof mediaIngestRequestSchema.shape.captureSession>,
  artifacts: z.input<typeof mediaIngestRequestSchema.shape.artifacts>,
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
