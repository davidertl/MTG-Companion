import { SqliteClient } from "../../storage/sqlite/client.ts";

export function sessionsRoute(
  sqlite: SqliteClient,
  query: Record<string, string | undefined>,
): Array<Record<string, unknown>> {
  return sqlite.listSessions(query).map((session) => ({
    ...session,
    metadata: JSON.parse(session.metadata_json),
  }));
}

export function sessionRoute(sqlite: SqliteClient, sessionId: string): Record<string, unknown> | null {
  const session = sqlite.getSession(sessionId);
  if (!session) {
    return null;
  }
  return {
    ...session,
    metadata: JSON.parse(session.metadata_json),
  };
}

export function sessionEventsRoute(sqlite: SqliteClient, sessionId: string): Array<Record<string, unknown>> {
  return sqlite.getSessionEvents(sessionId).map((event) => ({
    ...event,
    actor: event.actor_json ? JSON.parse(event.actor_json) : null,
    object: event.object_json ? JSON.parse(event.object_json) : null,
    targets: event.targets_json ? JSON.parse(event.targets_json) : [],
    payload: JSON.parse(event.payload_json),
    provenance: JSON.parse(event.provenance_json),
  }));
}
