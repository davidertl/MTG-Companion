import {
  backendEventEnvelopeSchema,
  type BackendEventEnvelope,
} from "../../../../packages/shared-schema/src/index";

export interface EventStore {
  values: BackendEventEnvelope[];
}

export interface EventApplyResult {
  accepted: BackendEventEnvelope[];
  deduplicatedCount: number;
  totalStored: number;
}

export function createInMemoryEventStore(): EventStore {
  return { values: [] };
}

export function mergeBackendEvents(
  existing: BackendEventEnvelope[],
  updates: BackendEventEnvelope[],
): EventApplyResult {
  const merged = new Map(
    existing.map((item) => [`${item.sourceApp}:${item.eventId}`, item]),
  );
  let deduplicatedCount = 0;

  for (const update of updates) {
    const key = `${update.sourceApp}:${update.eventId}`;
    if (merged.has(key)) {
      deduplicatedCount += 1;
    }
    merged.set(key, update);
  }

  const values = [...merged.values()];
  return {
    accepted: updates,
    deduplicatedCount,
    totalStored: values.length,
  };
}

export function applyBackendEvents(
  store: EventStore,
  input: unknown[],
): EventApplyResult {
  const accepted = input.map((candidate) =>
    backendEventEnvelopeSchema.parse(candidate),
  );
  const result = mergeBackendEvents(store.values, accepted);
  store.values = [...new Map(
    [...store.values, ...accepted].map((item) => [
      `${item.sourceApp}:${item.eventId}`,
      item,
    ]),
  ).values()];
  return {
    accepted: result.accepted,
    deduplicatedCount: result.deduplicatedCount,
    totalStored: store.values.length,
  };
}
