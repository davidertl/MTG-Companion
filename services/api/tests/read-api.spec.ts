import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startApiServer, type StartedApiServer } from "../src/index";
import { SqliteClient } from "../src/storage/sqlite/client";

let server: StartedApiServer;
let sqlite: SqliteClient;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mancutg-read-"));
  sqlite = new SqliteClient({
    dbPath: join(dir, "store.sqlite3"),
    schemaPath: "services/api/src/storage/sqlite/schema.sql",
  });
  server = await startApiServer(0, { sqlite });

  const fixture = JSON.parse(
    readFileSync("services/api/tests/fixtures/ingest-batches/paperc-minimal.json", "utf8"),
  );
  fixture.events[0] = {
    ...fixture.events[0],
    eventType: "mtg.paper.review.requested",
  };
  await fetch(`${server.baseUrl}/v1/ingest/batches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixture),
  });
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("read APIs", () => {
  it("returns sessions list and details", async () => {
    const sessions = await fetch(`${server.baseUrl}/v1/sessions`);
    const sessionsJson = (await sessions.json()) as Array<Record<string, unknown>>;
    expect(sessions.status).toBe(200);
    expect(sessionsJson.length).toBeGreaterThan(0);

    const sessionId = sessionsJson[0].id as string;
    const detail = await fetch(`${server.baseUrl}/v1/sessions/${sessionId}`);
    expect(detail.status).toBe(200);

    const events = await fetch(`${server.baseUrl}/v1/sessions/${sessionId}/events`);
    const eventsJson = (await events.json()) as Array<Record<string, unknown>>;
    expect(events.status).toBe(200);
    expect(eventsJson.length).toBeGreaterThan(0);
  });

  it("returns empty review queue when none pending", async () => {
    const queue = await fetch(`${server.baseUrl}/v1/review-queue`);
    const queueJson = (await queue.json()) as Array<Record<string, unknown>>;
    expect(queueJson.length).toBe(1);

    const target = queueJson[0].id as string;
    await fetch(`${server.baseUrl}/v1/review-queue/${target}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "accept" }),
    });
    const queueAfter = await fetch(`${server.baseUrl}/v1/review-queue`);
    await expect(queueAfter.json()).resolves.toEqual([]);
  });

  it("returns 404 for unknown review event", async () => {
    const response = await fetch(`${server.baseUrl}/v1/review-queue/missing/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "discard" }),
    });
    expect(response.status).toBe(404);
  });

  it("resolve appends review event visible in session events", async () => {
    const queue = await fetch(`${server.baseUrl}/v1/review-queue`);
    const queueJson = (await queue.json()) as Array<Record<string, unknown>>;
    const target = queueJson[0].id as string;
    const sessionId = queueJson[0].session_id as string;

    const resolved = await fetch(`${server.baseUrl}/v1/review-queue/${target}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "accept", correctedName: "Island" }),
    });
    expect(resolved.status).toBe(200);

    const events = await fetch(`${server.baseUrl}/v1/sessions/${sessionId}/events`);
    const eventList = (await events.json()) as Array<Record<string, unknown>>;
    expect(eventList.some((item) => item.event_type === "mtg.paper.card.observed.confirmed")).toBe(
      true,
    );
  });
});
