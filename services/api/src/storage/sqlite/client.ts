import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

import type {
  IngestBatchError,
  IngestBatchRequest,
  IngestBatchResponse,
  IngestEvent,
} from "../../../../../packages/shared-schema/src/index.ts";

export interface SqliteClientOptions {
  dbPath: string;
  schemaPath: string;
}

type PersistedBatchMeta = {
  requestHash?: string;
  errors?: IngestBatchError[];
};

export interface SessionRow {
  id: string;
  producer_id: string;
  source_session_id: string;
  game_key: string;
  mode: string;
  source: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  producer_id: string;
  session_id: string;
  source_event_id: string;
  game_key: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  seq: number | null;
  actor_json: string | null;
  object_json: string | null;
  targets_json: string | null;
  payload_json: string;
  confidence: number | null;
  review_status: string;
  provenance_json: string;
}

export class SqliteClient {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteClientOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    try {
      this.db.exec(readFileSync(options.schemaPath, "utf8"));
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  public close(): void {
    this.db.close();
  }

  public listTables(): string[] {
    const rows = this.db
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  public listIndexes(): string[] {
    const rows = this.db
      .prepare("select name from sqlite_master where type = 'index' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  public createOrGetBatch(payload: IngestBatchRequest): IngestBatchResponse {
    const existing = this.db
      .prepare("select * from ingest_batches where idempotency_key = ?")
      .get(payload.idempotencyKey) as
      | {
          id: string;
          accepted_count: number;
          duplicate_count: number;
          rejected_count: number;
          errors_json: string;
        }
      | undefined;
    const requestHash = hashRequest(payload);

    if (existing) {
      const parsed = parseBatchMeta(existing.errors_json);
      if (parsed.requestHash && parsed.requestHash !== requestHash) {
        throw new Error("immutable-batch-conflict");
      }

      return {
        batchId: existing.id,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        errors: [],
      };
    }

    const producerId = this.upsertProducer(payload.producer);
    this.upsertGame(payload.game);
    const sessionId = this.upsertSession(producerId, payload);

    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const errors: IngestBatchError[] = [];
    const receivedAt = new Date().toISOString();

    for (const event of payload.events) {
      if (!isEventPayloadValid(event)) {
        rejected += 1;
        errors.push({
          eventId: event.eventId,
          code: "invalid_payload",
          message: "payload must be a non-empty object",
        });
        continue;
      }

      try {
        this.db
          .prepare(
            `insert into events (
              id, producer_id, session_id, source_event_id, game_key, event_type, occurred_at, received_at,
              seq, actor_json, object_json, targets_json, payload_json, confidence, review_status, provenance_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            producerId,
            sessionId,
            event.sourceEventId,
            payload.game.gameKey,
            event.eventType,
            event.occurredAt,
            receivedAt,
            event.seq ?? null,
            event.actor ? JSON.stringify(event.actor) : null,
            event.object ? JSON.stringify(event.object) : null,
            JSON.stringify(event.targets ?? []),
            JSON.stringify(event.payload ?? {}),
            event.confidence ?? null,
            deriveReviewStatus(event),
            JSON.stringify(event.provenance ?? {}),
          );
        accepted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed")) {
          duplicates += 1;
          continue;
        }

        rejected += 1;
        errors.push({
          eventId: event.eventId,
          code: "invalid_payload",
          message,
        });
      }
    }

    const batchId = `batch_${randomUUID()}`;
    const meta: PersistedBatchMeta = {
      requestHash,
      errors,
    };
    this.db
      .prepare(
        "insert into ingest_batches (id, producer_id, idempotency_key, received_at, accepted_count, duplicate_count, rejected_count, errors_json) values (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        batchId,
        producerId,
        payload.idempotencyKey,
        receivedAt,
        accepted,
        duplicates,
        rejected,
        JSON.stringify(meta),
      );

    return {
      batchId,
      accepted,
      duplicates,
      rejected,
      errors,
    };
  }

  public getOverview(): Record<string, unknown> {
    const activeSessions = this.db
      .prepare("select count(*) as count from sessions where status = 'active'")
      .get() as { count: number };
    const activeProducers = this.db
      .prepare("select count(distinct producer_id) as count from sessions where status = 'active'")
      .get() as { count: number };
    const reviewQueueCount = this.db
      .prepare("select count(*) as count from events where review_status = 'pending'")
      .get() as { count: number };
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const eventsFiveMinutes = this.db
      .prepare("select count(*) as count from events where occurred_at >= ?")
      .get(fiveMinutesAgo) as { count: number };
    const errorsFiveMinutes = this.db
      .prepare("select count(*) as count from ingest_batches where rejected_count > 0 and received_at >= ?")
      .get(fiveMinutesAgo) as { count: number };

    return {
      activeProducers: activeProducers.count,
      activeSessions: activeSessions.count,
      eventsLast5Minutes: eventsFiveMinutes.count,
      errorsLast5Minutes: errorsFiveMinutes.count,
      reviewQueueCount: reviewQueueCount.count,
    };
  }

  public listGames(): Array<Record<string, unknown>> {
    return this.db.prepare("select * from games order by game_key asc").all() as Array<Record<string, unknown>>;
  }

  public listSessions(filters: Record<string, string | undefined>): SessionRow[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.game) {
      clauses.push("game_key = ?");
      values.push(filters.game);
    }
    if (filters.mode) {
      clauses.push("mode = ?");
      values.push(filters.mode);
    }
    if (filters.status) {
      clauses.push("status = ?");
      values.push(filters.status);
    }

    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    return this.db
      .prepare(`select * from sessions ${where} order by started_at desc, created_at desc`)
      .all(...values) as unknown as SessionRow[];
  }

  public getSession(sessionId: string): SessionRow | undefined {
    return this.db.prepare("select * from sessions where id = ?").get(sessionId) as
      | SessionRow
      | undefined;
  }

  public getSessionEvents(sessionId: string): EventRow[] {
    return this.db
      .prepare("select * from events where session_id = ? order by coalesce(seq, 0) asc, occurred_at asc")
      .all(sessionId) as unknown as EventRow[];
  }

  public getEvent(eventId: string): EventRow | undefined {
    return this.db.prepare("select * from events where id = ?").get(eventId) as EventRow | undefined;
  }

  public getReviewQueue(): EventRow[] {
    return this.db
      .prepare("select * from events where review_status = 'pending' order by occurred_at asc")
      .all() as unknown as EventRow[];
  }

  public resolveReview(eventId: string, resolution: "accept" | "discard", correctedName?: string): EventRow {
    const target = this.getEvent(eventId);
    if (!target || target.review_status !== "pending") {
      throw new Error("review-event-not-found");
    }

    const payload = JSON.parse(target.payload_json) as Record<string, unknown>;
    if (correctedName) {
      payload.cardName = correctedName;
    }

    const appendedId = `review_${randomUUID()}`;
    const reviewType =
      resolution === "discard"
        ? "mtg.paper.review.discarded"
        : "mtg.paper.card.observed.confirmed";
    this.db
      .prepare(
        `insert into events (
          id, producer_id, session_id, source_event_id, game_key, event_type, occurred_at, received_at, seq,
          actor_json, object_json, targets_json, payload_json, confidence, review_status, provenance_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        appendedId,
        target.producer_id,
        target.session_id,
        appendedId,
        target.game_key,
        reviewType,
        new Date().toISOString(),
        new Date().toISOString(),
        (target.seq ?? 0) + 1,
        null,
        target.object_json,
        target.targets_json ?? "[]",
        JSON.stringify({
          ...payload,
          resolution,
          targetEventId: target.id,
          confirmedBy: "user",
        }),
        target.confidence,
        resolution === "discard" ? "rejected" : "confirmed",
        target.provenance_json,
      );

    this.db
      .prepare("update events set review_status = ? where id = ?")
      .run(resolution === "discard" ? "rejected" : "confirmed", eventId);

    return this.getEvent(appendedId)!;
  }

  public diagnostics(): Record<string, unknown> {
    const producerVersions = this.db
      .prepare("select app, version, count(*) as count from producers group by app, version")
      .all() as Array<Record<string, unknown>>;
    const lastErrors = this.db
      .prepare("select id, rejected_count, errors_json, received_at from ingest_batches where rejected_count > 0 order by received_at desc limit 10")
      .all() as Array<Record<string, unknown>>;
    return {
      producerVersions,
      lastIngestionErrors: lastErrors,
      dbStatus: "ok",
    };
  }

  private upsertProducer(producer: IngestBatchRequest["producer"]): string {
    const id = `${producer.app}:${producer.instanceId}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "insert into producers (id, app, version, instance_id, display_name, created_at) values (?, ?, ?, ?, ?, ?) on conflict(id) do update set version = excluded.version, display_name = excluded.display_name",
      )
      .run(id, producer.app, producer.version, producer.instanceId, producer.displayName ?? null, now);
    return id;
  }

  private upsertGame(game: IngestBatchRequest["game"]): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "insert into games (game_key, game_family, title, default_mode, created_at) values (?, ?, ?, ?, ?) on conflict(game_key) do update set title = excluded.title, default_mode = excluded.default_mode",
      )
      .run(game.gameKey, game.gameFamily, game.title, game.mode, now);
  }

  private upsertSession(producerId: string, payload: IngestBatchRequest): string {
    const existing = this.db
      .prepare("select id from sessions where producer_id = ? and source_session_id = ?")
      .get(producerId, payload.session.sourceSessionId) as { id: string } | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare("update sessions set updated_at = ?, ended_at = coalesce(?, ended_at), metadata_json = ? where id = ?")
        .run(
          now,
          payload.session.endedAt ?? null,
          JSON.stringify(payload.session.metadata ?? {}),
          existing.id,
        );
      return existing.id;
    }

    const id = `session_${randomUUID()}`;
    this.db
      .prepare(
        "insert into sessions (id, producer_id, source_session_id, game_key, mode, source, started_at, ended_at, status, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        producerId,
        payload.session.sourceSessionId,
        payload.game.gameKey,
        payload.game.mode,
        payload.session.source,
        payload.session.startedAt,
        payload.session.endedAt ?? null,
        "active",
        JSON.stringify(payload.session.metadata ?? {}),
        now,
        now,
      );
    return id;
  }
}

function hashRequest(payload: IngestBatchRequest): string {
  const serialized = stableStringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
      .join(",")}}`;
  }
  return JSON.stringify(input);
}

function parseBatchMeta(raw: string): PersistedBatchMeta {
  try {
    const parsed = JSON.parse(raw) as PersistedBatchMeta | IngestBatchError[];
    if (Array.isArray(parsed)) {
      return { errors: parsed };
    }
    return parsed;
  } catch {
    return {};
  }
}

function deriveReviewStatus(event: IngestEvent): string {
  if (event.eventType === "mtg.paper.review.requested") {
    return "pending";
  }
  if (event.eventType === "mtg.paper.card.observed.confirmed") {
    return "confirmed";
  }
  return "none";
}

function isEventPayloadValid(event: IngestEvent): boolean {
  return (
    typeof event.payload === "object" &&
    event.payload !== null &&
    Object.keys(event.payload).length > 0
  );
}
