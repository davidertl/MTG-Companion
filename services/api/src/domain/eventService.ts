import {
  backendEventBatchEnvelopeSchema,
  type BackendEventBatchEnvelope,
  type BackendEventEnvelope,
  type BackendEventSession,
} from "../../../../packages/shared-schema/src/index";

export interface EventStore {
  sessions: BackendEventSession[];
  events: BackendEventEnvelope[];
  seenBatchKeys: string[];
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
    sessions: [],
    events: [],
    seenBatchKeys: [],
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
    const key = sessionKey(session.sourceApp, session.sourceSessionId);
    if (!sessionMap.has(key)) {
      acceptedSessions.push(session);
    }
    sessionMap.set(key, session);
  }

  const eventMap = new Map(
    store.events.map((event) => [eventKey(event), event]),
  );
  let deduplicatedCount = 0;
  const acceptedEvents: BackendEventEnvelope[] = [];

  for (const event of batch.events) {
    const sessionIdentity = sessionKey(event.sourceApp, event.sourceSessionId);
    if (!sessionMap.has(sessionIdentity)) {
      throw new Error(
        `unknown session ${event.sourceSessionId} for source app ${event.sourceApp}`,
      );
    }

    const key = eventKey(event);
    if (eventMap.has(key)) {
      deduplicatedCount += 1;
      continue;
    }

    acceptedEvents.push(event);
    eventMap.set(key, event);
  }

  store.sessions = [...sessionMap.values()];
  store.events = [...eventMap.values()];

  if (batch.idempotencyKey) {
    store.seenBatchKeys = [...store.seenBatchKeys, batch.idempotencyKey];
  }

  return {
    acceptedSessions,
    acceptedEvents,
    deduplicatedCount,
    duplicateBatch: false,
    totalStoredSessions: store.sessions.length,
    totalStoredEvents: store.events.length,
  };
}

function sessionKey(sourceApp: string, sourceSessionId: string): string {
  return `${sourceApp}:${sourceSessionId}`;
}

function eventKey(event: BackendEventEnvelope): string {
  return `${event.sourceApp}:${event.sourceSessionId}:${event.eventId}`;
}

export type { BackendEventBatchEnvelope };
