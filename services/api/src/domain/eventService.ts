import {
  backendEventBatchEnvelopeSchema,
  backendEventEnvelopeSchema,
  backendEventSessionSchema,
  validateAnalysisEventContract,
  type BackendEventBatchEnvelope,
  type BackendEventEnvelope,
  type BackendEventSession,
  type MediaArtifact,
  type MediaCaptureSession,
} from "../../../../packages/shared-schema/src/index.ts";
import {
  validatePapercEventContract,
  validatePapercSessionContract,
} from "../../../../packages/shared-schema/src/paperc.ts";

import {
  createInMemoryEventStore,
  createPersistentEventStore,
  resolveStore,
  type BackendStoreLike,
  type EventStore,
} from "../store/jsonStore.ts";

export { createInMemoryEventStore, createPersistentEventStore, resolveStore };
export type { BackendStoreLike, EventStore };

export interface EventApplyResult {
  acceptedSessions: BackendEventSession[];
  acceptedEvents: BackendEventEnvelope[];
  deduplicatedCount: number;
  duplicateBatch: boolean;
  totalStoredSessions: number;
  totalStoredEvents: number;
}

export function applyBackendEventBatch(
  storeLike: BackendStoreLike,
  input: unknown,
): EventApplyResult {
  const store = resolveStore(storeLike);
  const batch = backendEventBatchEnvelopeSchema.parse(input);

  if (batch.idempotencyKey && store.hasSeenBatchKey("events", batch.idempotencyKey)) {
    return {
      acceptedSessions: [],
      acceptedEvents: [],
      deduplicatedCount: batch.events.length,
      duplicateBatch: true,
      totalStoredSessions: store.countSessions(),
      totalStoredEvents: store.countEvents(),
    };
  }

  return store.transaction(() => {
    const acceptedSessions: BackendEventSession[] = [];
    for (const session of batch.sessions) {
      const validatedSession = validatePapercSessionContract(
        backendEventSessionSchema.parse(session),
      );
      if (!store.hasSession(validatedSession.sourceApp, validatedSession.sourceSessionId)) {
        acceptedSessions.push(validatedSession);
      }
      store.upsertSession(validatedSession);
    }

    let deduplicatedCount = 0;
    const acceptedEvents: BackendEventEnvelope[] = [];

    for (const event of batch.events) {
      // Enforce both the PaperC and analysis contracts on ingest. The analysis
      // validator restricts which apps may emit findings and pins the payload
      // shape; it is called for that throw-on-violation side effect only. We
      // keep the paperc-validated event (with its full payload) rather than the
      // validator's return value, because the analysis payload schema strips
      // unknown keys — including `tournamentId`, which the store needs to scope
      // findings to a tournament.
      const validatedEvent = validatePapercEventContract(
        backendEventEnvelopeSchema.parse(event),
      );
      validateAnalysisEventContract(validatedEvent);
      if (!store.hasSession(validatedEvent.sourceApp, validatedEvent.sourceSessionId)) {
        throw new Error(
          `unknown session ${validatedEvent.sourceSessionId} for source app ${validatedEvent.sourceApp}`,
        );
      }

      if (
        store.hasEvent(
          validatedEvent.sourceApp,
          validatedEvent.sourceSessionId,
          validatedEvent.eventId,
        )
      ) {
        deduplicatedCount += 1;
        continue;
      }

      store.appendEvent(validatedEvent);
      acceptedEvents.push(validatedEvent);
    }

    if (batch.idempotencyKey) {
      store.rememberBatchKey("events", batch.idempotencyKey);
    }

    return {
      acceptedSessions,
      acceptedEvents,
      deduplicatedCount,
      duplicateBatch: false,
      totalStoredSessions: store.countSessions(),
      totalStoredEvents: store.countEvents(),
    };
  });
}

export function upsertMediaState(
  storeLike: BackendStoreLike,
  session: MediaCaptureSession,
  artifacts: MediaArtifact[],
  idempotencyKey?: string,
): {
  createdSession: boolean;
  acceptedArtifactCount: number;
  duplicateArtifactCount: number;
  duplicateBatch: boolean;
  totalStoredMediaSessions: number;
  totalStoredMediaArtifacts: number;
} {
  const store = resolveStore(storeLike);

  if (idempotencyKey && store.hasSeenBatchKey("media", idempotencyKey)) {
    return {
      createdSession: false,
      acceptedArtifactCount: 0,
      duplicateArtifactCount: artifacts.length,
      duplicateBatch: true,
      totalStoredMediaSessions: store.countMediaSessions(),
      totalStoredMediaArtifacts: store.countMediaArtifacts(),
    };
  }

  return store.transaction(() => {
    const createdSession = !store.hasMediaSession(session.captureSessionId);
    store.upsertMediaSession(session);

    let acceptedArtifactCount = 0;
    let duplicateArtifactCount = 0;

    for (const artifact of artifacts) {
      if (store.hasMediaArtifact(artifact.captureSessionId, artifact.artifactId)) {
        duplicateArtifactCount += 1;
        continue;
      }
      store.addMediaArtifact(artifact);
      acceptedArtifactCount += 1;
    }

    if (idempotencyKey) {
      store.rememberBatchKey("media", idempotencyKey);
    }

    return {
      createdSession,
      acceptedArtifactCount,
      duplicateArtifactCount,
      duplicateBatch: false,
      totalStoredMediaSessions: store.countMediaSessions(),
      totalStoredMediaArtifacts: store.countMediaArtifacts(),
    };
  });
}

export type { BackendEventBatchEnvelope };
