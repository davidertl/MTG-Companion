import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function createServerWithSqlite() {
  const dir = mkdtempSync(join(tmpdir(), "mancutg-ingest-"));
  tempDirs.push(dir);
  const sqlite = new SqliteClient({
    dbPath: join(dir, "store.sqlite3"),
    schemaPath: "services/api/src/storage/sqlite/schema.sql",
  });
  return startApiServer(0, { sqlite });
}

describe("POST /v1/ingest/batches", () => {
  it("accepts a valid batch", async () => {
    const server = await createServerWithSqlite();
    servers.push(server);
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/arenac-minimal.json", "utf8"),
    );
    const response = await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(json.accepted).toBeGreaterThan(0);
    expect(json.duplicates).toBe(0);
    expect(json.rejected).toBe(0);
    expect(typeof json.batchId).toBe("string");
  });

  it("replays same idempotency key and identical payload", async () => {
    const server = await createServerWithSqlite();
    servers.push(server);
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/paperc-minimal.json", "utf8"),
    );
    const first = await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const firstJson = (await first.json()) as Record<string, unknown>;
    const second = await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const secondJson = (await second.json()) as Record<string, unknown>;
    expect(second.status).toBe(200);
    expect(secondJson.batchId).toBe(firstJson.batchId);
    expect(secondJson.accepted).toBe(0);
  });

  it("rejects immutable conflict when idempotency key is reused with different payload", async () => {
    const server = await createServerWithSqlite();
    servers.push(server);
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/arenac-minimal.json", "utf8"),
    );
    await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });

    const conflict = {
      ...fixture,
      events: [{ ...fixture.events[0], eventId: "changed-event" }],
    };
    const response = await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(conflict),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "immutable-batch-conflict" });
  });

  it("commits valid events and reports invalid payload errors", async () => {
    const server = await createServerWithSqlite();
    servers.push(server);
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/paperc-minimal.json", "utf8"),
    );
    fixture.events.push({
      ...fixture.events[0],
      eventId: "invalid-1",
      sourceEventId: "invalid-1",
      payload: {},
    });

    const response = await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(json.accepted).toBe(1);
    expect(json.rejected).toBe(1);
    expect(Array.isArray(json.errors)).toBe(true);
    expect((json.errors as Array<Record<string, unknown>>)[0].eventId).toBe("invalid-1");
  });
});
