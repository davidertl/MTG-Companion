import type {
  BackendEventEnvelope,
  BackendEventSession,
  MediaArtifact,
  MediaCaptureSession,
  TournamentMembership,
  TournamentSettings,
} from "../../../../packages/shared-schema/src/index.ts";

export type BatchKeyScope = "events" | "media";

export interface StoredEvent {
  cursor: number;
  event: BackendEventEnvelope;
}

/**
 * Auth/identity records added by unit W2.3. These live in the same store as the
 * event/media data so both the JSON and SQLite backends persist them uniformly.
 * Bearer tokens are never stored in the clear — only their sha256 hash.
 */
export interface StoredUser {
  userId: string;
  displayName: string;
  createdAt: string;
}

export interface StoredToken {
  tokenHash: string;
  userId: string;
  createdAt: string;
}

export interface StoredTournament {
  tournamentId: string;
  name?: string;
  settings: TournamentSettings;
  createdBy: string;
  createdAt: string;
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

  // --- Auth / identity (W2.3) ------------------------------------------------
  // Users are keyed by `userId`; tokens by their sha256 `tokenHash`.
  insertUser(user: StoredUser): void;
  getUser(userId: string): StoredUser | undefined;

  insertToken(token: StoredToken): void;
  findUserIdByTokenHash(tokenHash: string): string | undefined;

  // Tournaments and their per-user role memberships. Membership identity is
  // (tournamentId, userId) — a user holds at most one role per tournament.
  insertTournament(tournament: StoredTournament): void;
  getTournament(tournamentId: string): StoredTournament | undefined;

  upsertMembership(membership: TournamentMembership): void;
  getMembership(tournamentId: string, userId: string): TournamentMembership | undefined;
  listMemberships(tournamentId: string): TournamentMembership[];

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
