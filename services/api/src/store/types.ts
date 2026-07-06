import type {
  BackendEventEnvelope,
  BackendEventSession,
  MediaArtifact,
  MediaCaptureSession,
} from "../../../../packages/shared-schema/src/index.ts";

export type BatchKeyScope = "events" | "media";

export interface StoredEvent {
  cursor: number;
  event: BackendEventEnvelope;
}

/**
 * Persistence contract required by `eventService` and `mediaSessionService`.
 *
 * Semantics the implementations must uphold (they mirror the historical
 * JSON-file store exactly):
 * - Events are append-only: `appendEvent` inserts, nothing ever updates or
 *   deletes an event row. Event identity is `sourceApp:sourceSessionId:eventId`.
 * - `appendEvent` returns a strictly monotonically increasing cursor.
 * - Batch idempotency keys are scoped: an "events" key never collides with a
 *   "media" key.
 * - Media artifact identity is `captureSessionId:artifactId`.
 * - `transaction` applies `work` atomically: if `work` throws, no mutation
 *   performed inside it becomes visible or persisted.
 */
export interface Store {
  transaction<T>(work: () => T): T;

  hasSeenBatchKey(scope: BatchKeyScope, key: string): boolean;
  rememberBatchKey(scope: BatchKeyScope, key: string): void;

  hasSession(sourceApp: string, sourceSessionId: string): boolean;
  upsertSession(session: BackendEventSession): void;
  countSessions(): number;

  hasEvent(sourceApp: string, sourceSessionId: string, eventId: string): boolean;
  appendEvent(event: BackendEventEnvelope): number;
  countEvents(): number;
  readEventsAfter(cursor: number, limit: number, tournamentId?: string): StoredEvent[];

  hasMediaSession(captureSessionId: string): boolean;
  upsertMediaSession(session: MediaCaptureSession): void;
  countMediaSessions(): number;

  hasMediaArtifact(captureSessionId: string, artifactId: string): boolean;
  addMediaArtifact(artifact: MediaArtifact): void;
  countMediaArtifacts(): number;

  close?(): void;
}

export function isStore(candidate: unknown): candidate is Store {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const store = candidate as Partial<Store>;
  return (
    typeof store.transaction === "function" &&
    typeof store.appendEvent === "function" &&
    typeof store.readEventsAfter === "function"
  );
}

export function eventTournamentId(event: BackendEventEnvelope): string | undefined {
  const payload = event.payload as Record<string, unknown> | undefined;
  const value = payload?.["tournamentId"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
