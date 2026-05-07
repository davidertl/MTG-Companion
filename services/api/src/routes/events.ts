import {
  backendEventBatchEnvelopeSchema,
  type BackendEventEnvelope,
  type BackendEventSession,
} from "../../../../packages/shared-schema/src/index.ts";
import { applyBackendEventBatch, type EventStore } from "../domain/eventService.ts";

export interface EventsRouteResult {
  acceptedSessionCount: number;
  acceptedEventCount: number;
  deduplicatedCount: number;
  duplicateBatch: boolean;
  totalStoredSessions: number;
  totalStoredEvents: number;
  sourceApps: Array<BackendEventEnvelope["sourceApp"]>;
  sourceSessionIds: Array<BackendEventSession["sourceSessionId"]>;
}

export function eventsRoute(input: unknown, store: EventStore): EventsRouteResult {
  // Legacy JSON-store ingest path preserved for compatibility with existing /events clients.
  const payload = backendEventBatchEnvelopeSchema.parse(input);
  const result = applyBackendEventBatch(store, payload);

  return {
    acceptedSessionCount: result.acceptedSessions.length,
    acceptedEventCount: result.acceptedEvents.length,
    deduplicatedCount: result.deduplicatedCount,
    duplicateBatch: result.duplicateBatch,
    totalStoredSessions: result.totalStoredSessions,
    totalStoredEvents: result.totalStoredEvents,
    sourceApps: [...new Set(result.acceptedEvents.map((event) => event.sourceApp))],
    sourceSessionIds: [
      ...new Set(result.acceptedEvents.map((event) => event.sourceSessionId)),
    ],
  };
}
