import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  BackendEventEnvelope,
  BackendEventSession,
  MediaArtifact,
  MediaCaptureSession,
  TournamentMembership,
  TournamentRole,
  TournamentSettings,
} from "../../../../packages/shared-schema/src/index.ts";

import {
  eventTournamentId,
  type BatchKeyScope,
  type Store,
  type StoredEvent,
  type StoredToken,
  type StoredTournament,
  type StoredUser,
} from "./types.ts";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  source_app TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  session_json TEXT NOT NULL,
  PRIMARY KEY (source_app, source_session_id)
);

CREATE TABLE IF NOT EXISTS events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  tournament_id TEXT,
  event_json TEXT NOT NULL,
  UNIQUE (source_app, source_session_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_tournament_cursor
  ON events (tournament_id, cursor);

CREATE TABLE IF NOT EXISTS media_sessions (
  capture_session_id TEXT PRIMARY KEY,
  session_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_artifacts (
  capture_session_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  PRIMARY KEY (capture_session_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS seen_batch_keys (
  scope TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  PRIMARY KEY (scope, batch_key)
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);

CREATE TABLE IF NOT EXISTS tournaments (
  tournament_id TEXT PRIMARY KEY,
  name TEXT,
  settings_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
`;

/**
 * `node:sqlite`-backed implementation of the `Store` interface.
 *
 * Dedupe identities mirror the legacy JSON store exactly:
 * - events:   UNIQUE (source_app, source_session_id, event_id)
 * - media:    PRIMARY KEY (capture_session_id, artifact_id)
 * - batches:  PRIMARY KEY (scope, batch_key) — "events" and "media" scopes
 *             never collide.
 *
 * Events are append-only: there is no UPDATE or DELETE statement for the
 * `events` table anywhere in this module. `cursor` is a per-insert monotonic
 * INTEGER PRIMARY KEY AUTOINCREMENT used by the pull-sync endpoint.
 */
export class SqliteEventStore implements Store {
  private readonly db: DatabaseSync;
  private inTransaction = false;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
  }

  transaction<T>(work: () => T): T {
    if (this.inTransaction) {
      // Nested use: the outer transaction owns atomicity.
      return work();
    }

    this.db.exec("BEGIN IMMEDIATE;");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  hasSeenBatchKey(scope: BatchKeyScope, key: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM seen_batch_keys WHERE scope = ? AND batch_key = ?")
      .get(scope, key);
    return row !== undefined;
  }

  rememberBatchKey(scope: BatchKeyScope, key: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO seen_batch_keys (scope, batch_key) VALUES (?, ?)")
      .run(scope, key);
  }

  hasSession(sourceApp: string, sourceSessionId: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS present FROM sessions WHERE source_app = ? AND source_session_id = ?",
      )
      .get(sourceApp, sourceSessionId);
    return row !== undefined;
  }

  upsertSession(session: BackendEventSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (source_app, source_session_id, session_json)
         VALUES (?, ?, ?)
         ON CONFLICT (source_app, source_session_id)
         DO UPDATE SET session_json = excluded.session_json`,
      )
      .run(session.sourceApp, session.sourceSessionId, JSON.stringify(session));
  }

  countSessions(): number {
    return this.countRows("sessions");
  }

  hasEvent(sourceApp: string, sourceSessionId: string, eventId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM events
         WHERE source_app = ? AND source_session_id = ? AND event_id = ?`,
      )
      .get(sourceApp, sourceSessionId, eventId);
    return row !== undefined;
  }

  appendEvent(event: BackendEventEnvelope): number {
    const result = this.db
      .prepare(
        `INSERT INTO events
           (source_app, source_session_id, event_id, event_type, occurred_at, tournament_id, event_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.sourceApp,
        event.sourceSessionId,
        event.eventId,
        event.eventType,
        event.occurredAt,
        eventTournamentId(event) ?? null,
        JSON.stringify(event),
      );
    return Number(result.lastInsertRowid);
  }

  countEvents(): number {
    return this.countRows("events");
  }

  readEventsAfter(cursor: number, limit: number, tournamentId?: string): StoredEvent[] {
    const rows = (
      tournamentId === undefined
        ? this.db
            .prepare(
              `SELECT cursor, event_json FROM events
               WHERE cursor > ?
               ORDER BY cursor ASC
               LIMIT ?`,
            )
            .all(cursor, limit)
        : this.db
            .prepare(
              `SELECT cursor, event_json FROM events
               WHERE cursor > ? AND tournament_id = ?
               ORDER BY cursor ASC
               LIMIT ?`,
            )
            .all(cursor, tournamentId, limit)
    ) as Array<{ cursor: number | bigint; event_json: string }>;

    return rows.map((row) => ({
      cursor: Number(row.cursor),
      event: JSON.parse(row.event_json) as BackendEventEnvelope,
    }));
  }

  hasMediaSession(captureSessionId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM media_sessions WHERE capture_session_id = ?")
      .get(captureSessionId);
    return row !== undefined;
  }

  upsertMediaSession(session: MediaCaptureSession): void {
    this.db
      .prepare(
        `INSERT INTO media_sessions (capture_session_id, session_json)
         VALUES (?, ?)
         ON CONFLICT (capture_session_id)
         DO UPDATE SET session_json = excluded.session_json`,
      )
      .run(session.captureSessionId, JSON.stringify(session));
  }

  countMediaSessions(): number {
    return this.countRows("media_sessions");
  }

  hasMediaArtifact(captureSessionId: string, artifactId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM media_artifacts
         WHERE capture_session_id = ? AND artifact_id = ?`,
      )
      .get(captureSessionId, artifactId);
    return row !== undefined;
  }

  addMediaArtifact(artifact: MediaArtifact): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO media_artifacts (capture_session_id, artifact_id, artifact_json)
         VALUES (?, ?, ?)`,
      )
      .run(artifact.captureSessionId, artifact.artifactId, JSON.stringify(artifact));
  }

  countMediaArtifacts(): number {
    return this.countRows("media_artifacts");
  }

  insertUser(user: StoredUser): void {
    this.db
      .prepare(
        `INSERT INTO users (user_id, display_name, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(user.userId, user.displayName, user.createdAt);
  }

  getUser(userId: string): StoredUser | undefined {
    const row = this.db
      .prepare(
        "SELECT user_id, display_name, created_at FROM users WHERE user_id = ?",
      )
      .get(userId) as
      | { user_id: string; display_name: string; created_at: string }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      userId: row.user_id,
      displayName: row.display_name,
      createdAt: row.created_at,
    };
  }

  insertToken(token: StoredToken): void {
    this.db
      .prepare(
        `INSERT INTO auth_tokens (token_hash, user_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(token.tokenHash, token.userId, token.createdAt);
  }

  findUserIdByTokenHash(tokenHash: string): string | undefined {
    const row = this.db
      .prepare("SELECT user_id FROM auth_tokens WHERE token_hash = ?")
      .get(tokenHash) as { user_id: string } | undefined;
    return row?.user_id;
  }

  insertTournament(tournament: StoredTournament): void {
    this.db
      .prepare(
        `INSERT INTO tournaments (tournament_id, name, settings_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        tournament.tournamentId,
        tournament.name ?? null,
        JSON.stringify(tournament.settings),
        tournament.createdBy,
        tournament.createdAt,
      );
  }

  getTournament(tournamentId: string): StoredTournament | undefined {
    const row = this.db
      .prepare(
        `SELECT tournament_id, name, settings_json, created_by, created_at
         FROM tournaments WHERE tournament_id = ?`,
      )
      .get(tournamentId) as
      | {
          tournament_id: string;
          name: string | null;
          settings_json: string;
          created_by: string;
          created_at: string;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      tournamentId: row.tournament_id,
      name: row.name ?? undefined,
      settings: JSON.parse(row.settings_json) as TournamentSettings,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  upsertMembership(membership: TournamentMembership): void {
    this.db
      .prepare(
        `INSERT INTO memberships (tournament_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT (tournament_id, user_id)
         DO UPDATE SET role = excluded.role`,
      )
      .run(membership.tournamentId, membership.userId, membership.role);
  }

  getMembership(
    tournamentId: string,
    userId: string,
  ): TournamentMembership | undefined {
    const row = this.db
      .prepare(
        `SELECT tournament_id, user_id, role FROM memberships
         WHERE tournament_id = ? AND user_id = ?`,
      )
      .get(tournamentId, userId) as
      | { tournament_id: string; user_id: string; role: string }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      tournamentId: row.tournament_id,
      userId: row.user_id,
      role: row.role as TournamentRole,
    };
  }

  listMemberships(tournamentId: string): TournamentMembership[] {
    const rows = this.db
      .prepare(
        `SELECT tournament_id, user_id, role FROM memberships
         WHERE tournament_id = ? ORDER BY user_id ASC`,
      )
      .all(tournamentId) as Array<{
      tournament_id: string;
      user_id: string;
      role: string;
    }>;
    return rows.map((row) => ({
      tournamentId: row.tournament_id,
      userId: row.user_id,
      role: row.role as TournamentRole,
    }));
  }

  close(): void {
    this.db.close();
  }

  private countRows(table: "sessions" | "events" | "media_sessions" | "media_artifacts"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total: number | bigint;
    };
    return Number(row.total);
  }
}

export function createSqliteStore(path: string): SqliteEventStore {
  return new SqliteEventStore(path);
}
