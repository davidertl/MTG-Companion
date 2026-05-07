import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  backendEventBatchEnvelopeSchema,
  backendEventEnvelopeSchema,
  backendEventSessionSchema,
  mediaArtifactSchema,
  mediaCaptureSessionSchema,
  type BackendEventBatchEnvelope,
  type BackendEventEnvelope,
  type BackendEventSession,
  type MediaArtifact,
  type MediaCaptureSession,
} from "../../../../packages/shared-schema/src/index";
import {
  validatePapercEventContract,
  validatePapercSessionContract,
} from "../../../../packages/shared-schema/src/paperc";

type PersistedStoreFile = {
  sessions: BackendEventSession[];
  events: BackendEventEnvelope[];
  seenBatchKeys: string[];
  mediaSessions: MediaCaptureSession[];
  mediaArtifacts: MediaArtifact[];
  seenMediaBatchKeys: string[];
};

export interface EventStore {
  filePath?: string;
  sessions: BackendEventSession[];
  events: BackendEventEnvelope[];
  seenBatchKeys: string[];
  mediaSessions: MediaCaptureSession[];
  mediaArtifacts: MediaArtifact[];
  seenMediaBatchKeys: string[];
}

export interface EventApplyResult {
  acceptedSessions: BackendEventSession[];
  acceptedEvents: BackendEventEnvelope[];
  deduplicatedCount: number;
  duplicateBatch: boolean;
  totalStoredSessions: number;
  totalStoredEvents: number;
}

export function createInMemoryEventStore(): EventStore {
  return {
    filePath: undefined,
    sessions: [],
    events: [],
    seenBatchKeys: [],
    mediaSessions: [],
    mediaArtifacts: [],
    seenMediaBatchKeys: [],
  };
}

export function createPersistentEventStore(filePath: string): EventStore {
  if (!existsSync(filePath)) {
    return {
      ...createInMemoryEventStore(),
      filePath,
    };
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = parsePersistedStore(JSON.parse(raw));
  return {
    filePath,
    ...parsed,
  };
}

export function applyBackendEventBatch(
  store: EventStore,
  input: unknown,
): EventApplyResult {
  const batch = backendEventBatchEnvelopeSchema.parse(input);

  if (batch.idempotencyKey && store.seenBatchKeys.includes(batch.idempotencyKey)) {
    return {
      acceptedSessions: [],
      acceptedEvents: [],
      deduplicatedCount: batch.events.length,
      duplicateBatch: true,
      totalStoredSessions: store.sessions.length,
      totalStoredEvents: store.events.length,
    };
  }

  const sessionMap = new Map(
    store.sessions.map((session) => [sessionKey(session.sourceApp, session.sourceSessionId), session]),
  );
  const acceptedSessions: BackendEventSession[] = [];
  for (const session of batch.sessions) {
    const validatedSession = validatePapercSessionContract(
      backendEventSessionSchema.parse(session),
    );
    const key = sessionKey(validatedSession.sourceApp, validatedSession.sourceSessionId);
    if (!sessionMap.has(key)) {
      acceptedSessions.push(validatedSession);
    }
    sessionMap.set(key, validatedSession);
  }

  const eventMap = new Map(
    store.events.map((event) => [eventKey(event), event]),
  );
  let deduplicatedCount = 0;
  const acceptedEvents: BackendEventEnvelope[] = [];

  for (const event of batch.events) {
    const validatedEvent = validatePapercEventContract(
      backendEventEnvelopeSchema.parse(event),
    );
    const sessionIdentity = sessionKey(validatedEvent.sourceApp, validatedEvent.sourceSessionId);
    if (!sessionMap.has(sessionIdentity)) {
      throw new Error(
        `unknown session ${validatedEvent.sourceSessionId} for source app ${validatedEvent.sourceApp}`,
      );
    }

    const key = eventKey(validatedEvent);
    if (eventMap.has(key)) {
      deduplicatedCount += 1;
      continue;
    }

    acceptedEvents.push(validatedEvent);
    eventMap.set(key, validatedEvent);
  }

  store.sessions = [...sessionMap.values()];
  store.events = [...eventMap.values()];

  if (batch.idempotencyKey) {
    store.seenBatchKeys = [...store.seenBatchKeys, batch.idempotencyKey];
  }

  persistStore(store);

  return {
    acceptedSessions,
    acceptedEvents,
    deduplicatedCount,
    duplicateBatch: false,
    totalStoredSessions: store.sessions.length,
    totalStoredEvents: store.events.length,
  };
}

export function upsertMediaState(
  store: EventStore,
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
  if (idempotencyKey && store.seenMediaBatchKeys.includes(idempotencyKey)) {
    return {
      createdSession: false,
      acceptedArtifactCount: 0,
      duplicateArtifactCount: artifacts.length,
      duplicateBatch: true,
      totalStoredMediaSessions: store.mediaSessions.length,
      totalStoredMediaArtifacts: store.mediaArtifacts.length,
    };
  }

  const mediaSessionMap = new Map(
    store.mediaSessions.map((item) => [item.captureSessionId, item]),
  );
  const createdSession = !mediaSessionMap.has(session.captureSessionId);
  mediaSessionMap.set(session.captureSessionId, session);

  const artifactMap = new Map(
    store.mediaArtifacts.map((item) => [mediaArtifactKey(item), item]),
  );
  let acceptedArtifactCount = 0;
  let duplicateArtifactCount = 0;

  for (const artifact of artifacts) {
    const key = mediaArtifactKey(artifact);
    if (artifactMap.has(key)) {
      duplicateArtifactCount += 1;
      continue;
    }
    artifactMap.set(key, artifact);
    acceptedArtifactCount += 1;
  }

  store.mediaSessions = [...mediaSessionMap.values()];
  store.mediaArtifacts = [...artifactMap.values()];

  if (idempotencyKey) {
    store.seenMediaBatchKeys = [...store.seenMediaBatchKeys, idempotencyKey];
  }

  persistStore(store);

  return {
    createdSession,
    acceptedArtifactCount,
    duplicateArtifactCount,
    duplicateBatch: false,
    totalStoredMediaSessions: store.mediaSessions.length,
    totalStoredMediaArtifacts: store.mediaArtifacts.length,
  };
}

function sessionKey(sourceApp: string, sourceSessionId: string): string {
  return `${sourceApp}:${sourceSessionId}`;
}

function eventKey(event: BackendEventEnvelope): string {
  return `${event.sourceApp}:${event.sourceSessionId}:${event.eventId}`;
}

function mediaArtifactKey(artifact: MediaArtifact): string {
  return `${artifact.captureSessionId}:${artifact.artifactId}`;
}

function persistStore(store: EventStore): void {
  if (!store.filePath) {
    return;
  }

  const persisted: PersistedStoreFile = {
    sessions: store.sessions,
    events: store.events,
    seenBatchKeys: store.seenBatchKeys,
    mediaSessions: store.mediaSessions,
    mediaArtifacts: store.mediaArtifacts,
    seenMediaBatchKeys: store.seenMediaBatchKeys,
  };
  const tempPath = `${store.filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(persisted, null, 2));
  renameSync(tempPath, store.filePath);
}

function parsePersistedStore(input: unknown): PersistedStoreFile {
  const object = (input ?? {}) as Partial<PersistedStoreFile>;
  return {
    sessions: Array.isArray(object.sessions)
      ? object.sessions.map((session) =>
          validatePapercSessionContract(backendEventSessionSchema.parse(session)),
        )
      : [],
    events: Array.isArray(object.events)
      ? object.events.map((event) =>
          validatePapercEventContract(backendEventEnvelopeSchema.parse(event)),
        )
      : [],
    seenBatchKeys: Array.isArray(object.seenBatchKeys)
      ? object.seenBatchKeys.filter((item): item is string => typeof item === "string")
      : [],
    mediaSessions: Array.isArray(object.mediaSessions)
      ? object.mediaSessions.map((session) => mediaCaptureSessionSchema.parse(session))
      : [],
    mediaArtifacts: Array.isArray(object.mediaArtifacts)
      ? object.mediaArtifacts.map((artifact) => mediaArtifactSchema.parse(artifact))
      : [],
    seenMediaBatchKeys: Array.isArray(object.seenMediaBatchKeys)
      ? object.seenMediaBatchKeys.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export type { BackendEventBatchEnvelope };
