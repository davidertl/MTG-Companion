import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startApiServer, type StartedApiServer } from "../src/index";
import { SqliteClient } from "../src/storage/sqlite/client";

let server: StartedApiServer;
let sqlite: SqliteClient;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mancutg-legacy-"));
  sqlite = new SqliteClient({
    dbPath: join(dir, "store.sqlite3"),
    schemaPath: "services/api/src/storage/sqlite/schema.sql",
  });
  server = await startApiServer(0, { sqlite });
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("legacy /events compatibility", () => {
  it("keeps /events accepting legacy payloads", async () => {
    const response = await fetch(`${server.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessions: [
          {
            sourceSessionId: "legacy-session-1",
            sourceApp: "mancutg-arenac",
            sourceKind: "arena-log",
            platform: "windows",
            gameMode: "arena",
            startedAt: "2026-05-07T18:00:00.000Z",
          },
        ],
        events: [
          {
            eventId: "legacy-event-1",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "legacy-session-1",
            eventType: "arena.match.completed",
            occurredAt: "2026-05-07T18:00:01.000Z",
            provenance: [{ sourceKind: "arena-log", sourceSessionId: "legacy-session-1" }],
            payload: { ok: true },
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ acceptedEventCount: 1 });
  });

  it("keeps legacy and sqlite ingest stores isolated", async () => {
    await fetch(`${server.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessions: [
          {
            sourceSessionId: "legacy-session-2",
            sourceApp: "mancutg-arenac",
            sourceKind: "arena-log",
            platform: "windows",
            gameMode: "arena",
            startedAt: "2026-05-07T18:00:00.000Z",
          },
        ],
        events: [
          {
            eventId: "legacy-event-2",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "legacy-session-2",
            eventType: "arena.match.completed",
            occurredAt: "2026-05-07T18:00:01.000Z",
            provenance: [{ sourceKind: "arena-log", sourceSessionId: "legacy-session-2" }],
            payload: { ok: true },
          },
        ],
      }),
    });
    await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "new-batch-1",
        producer: { app: "mancutg-arenac", version: "0.1.0", instanceId: "device-a" },
        game: { gameKey: "mtg-arena", gameFamily: "mtg", title: "MTGA", mode: "arena" },
        session: {
          sourceSessionId: "new-session",
          startedAt: "2026-05-07T18:00:00.000Z",
          source: "player-log",
        },
        events: [
          {
            eventId: "new-event",
            sourceEventId: "new-event",
            eventType: "mtg.arena.log.line.parsed",
            occurredAt: "2026-05-07T18:00:01.000Z",
            payload: { ok: true },
            provenance: { source: "player.log" },
          },
        ],
      }),
    });

    const overview = await fetch(`${server.baseUrl}/v1/overview`);
    await expect(overview.json()).resolves.toMatchObject({ activeSessions: 1 });
  });

  it("retains old validation error shape for invalid legacy payloads", async () => {
    const response = await fetch(`${server.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid-request" });
  });
});
