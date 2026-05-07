import { SqliteClient } from "../../storage/sqlite/client.ts";

export function reviewQueueRoute(sqlite: SqliteClient): Array<Record<string, unknown>> {
  return sqlite.getReviewQueue().map((event) => ({
    ...event,
    payload: JSON.parse(event.payload_json),
    provenance: JSON.parse(event.provenance_json),
  }));
}

export function resolveReviewRoute(
  sqlite: SqliteClient,
  eventId: string,
  input: unknown,
): Record<string, unknown> {
  const payload = (input ?? {}) as { resolution?: "accept" | "discard"; correctedName?: string };
  if (!payload.resolution) {
    throw new Error("missing resolution");
  }
  const resolved = sqlite.resolveReview(eventId, payload.resolution, payload.correctedName);
  return {
    ...resolved,
    payload: JSON.parse(resolved.payload_json),
    provenance: JSON.parse(resolved.provenance_json),
  };
}
