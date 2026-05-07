import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { startApiServer, type StartedApiServer } from "../src/index";
import { SqliteClient } from "../src/storage/sqlite/client";

const servers: StartedApiServer[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupSqlite() {
  const dir = mkdtempSync(join(tmpdir(), "mancutg-sqlite-"));
  tempDirs.push(dir);
  return new SqliteClient({
    dbPath: join(dir, "store.sqlite3"),
    schemaPath: "services/api/src/storage/sqlite/schema.sql",
  });
}

describe("sqlite schema", () => {
  it("creates all required tables and indexes", () => {
    const sqlite = setupSqlite();
    const tables = sqlite.listTables();
    const indexes = sqlite.listIndexes();
    expect(tables).toEqual(
      expect.arrayContaining(["producers", "games", "sessions", "ingest_batches", "events"]),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_events_session_seq",
        "idx_events_type_time",
        "idx_sessions_game_time",
      ]),
    );
    sqlite.close();
  });

  it("enforces unique session identity by producer and source session", () => {
    const sqlite = setupSqlite();
    const request = {
      idempotencyKey: "batch-1",
      producer: {
        app: "mancutg-arenac" as const,
        version: "0.1.0",
        instanceId: "device-a",
      },
      game: { gameKey: "mtg-arena", gameFamily: "mtg", title: "MTGA", mode: "arena" as const },
      session: {
        sourceSessionId: "session-1",
        startedAt: "2026-05-07T18:00:00.000Z",
        source: "player-log",
        metadata: {},
      },
      events: [
        {
          eventId: "e1",
          sourceEventId: "s1",
          eventType: "mtg.arena.log.line.parsed",
          occurredAt: "2026-05-07T18:00:01.000Z",
          targets: [],
          payload: { ok: true },
          provenance: { source: "player.log", metadata: {} },
        },
      ],
    };

    sqlite.createOrGetBatch(request);
    sqlite.createOrGetBatch({ ...request, idempotencyKey: "batch-2", events: [{ ...request.events[0], eventId: "e2", sourceEventId: "s2" }] });
    expect(sqlite.listSessions({})).toHaveLength(1);
    sqlite.close();
  });

  it("fails startup on malformed SQL schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "mancutg-sqlite-bad-"));
    tempDirs.push(dir);
    const malformed = join(dir, "bad.sql");
    writeFileSync(malformed, "create table broken (");

    expect(
      () =>
        new SqliteClient({
          dbPath: join(dir, "store.sqlite3"),
          schemaPath: malformed,
        }),
    ).toThrowError();
  });

  it("keeps health endpoint available with sqlite enabled", async () => {
    const sqlite = setupSqlite();
    const server = await startApiServer(0, { sqlite });
    servers.push(server);
    const response = await fetch(`${server.baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", storage: "sqlite" });
  });
});
