import { SqliteClient } from "../../storage/sqlite/client.ts";

export function eventRoute(sqlite: SqliteClient, eventId: string): Record<string, unknown> | null {
  const event = sqlite.getEvent(eventId);
  if (!event) {
    return null;
  }
  return {
    ...event,
    actor: event.actor_json ? JSON.parse(event.actor_json) : null,
    object: event.object_json ? JSON.parse(event.object_json) : null,
    targets: event.targets_json ? JSON.parse(event.targets_json) : [],
    payload: JSON.parse(event.payload_json),
    provenance: JSON.parse(event.provenance_json),
  };
}
