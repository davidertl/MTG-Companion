import {
  backendEventEnvelopeSchema,
  type BackendEventEnvelope,
} from "../../../../packages/shared-schema/src/index";
import { applyBackendEvents, type EventStore } from "../domain/eventService";

export interface EventsRouteResult {
  acceptedCount: number;
  deduplicatedCount: number;
  totalStored: number;
  sourceApps: Array<BackendEventEnvelope["sourceApp"]>;
}

export function eventsRoute(input: unknown, store: EventStore): EventsRouteResult {
  const payload = backendEventEnvelopeSchema.array().parse(input);
  const result = applyBackendEvents(store, payload);

  return {
    acceptedCount: result.accepted.length,
    deduplicatedCount: result.deduplicatedCount,
    totalStored: store.values.length,
    sourceApps: [...new Set(result.accepted.map((event) => event.sourceApp))],
  };
}
