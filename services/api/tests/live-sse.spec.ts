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
  dir = mkdtempSync(join(tmpdir(), "mancutg-live-"));
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

async function readOneSseMessage(path: string): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(`${server.baseUrl}${path}`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const chunks: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(new TextDecoder().decode(value));
    if (chunks.join("").includes("ingest.accepted") || chunks.join("").includes("review.resolved")) {
      break;
    }
  }
  await reader.cancel();
  controller.abort();
  return chunks.join("");
}

describe("live SSE and security defaults", () => {
  it("pushes ingest updates to SSE clients", async () => {
    const streamPromise = readOneSseMessage("/v1/live");
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/arenac-minimal.json", "utf8"),
    );
    await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const message = await streamPromise;
    expect(message.includes("ingest.accepted")).toBe(true);
  });

  it("supports multiple subscribers", async () => {
    const one = readOneSseMessage("/v1/live");
    const two = readOneSseMessage("/v1/live");
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/paperc-minimal.json", "utf8"),
    );
    await fetch(`${server.baseUrl}/v1/ingest/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    const [first, second] = await Promise.all([one, two]);
    expect(first.includes("ingest.accepted")).toBe(true);
    expect(second.includes("ingest.accepted")).toBe(true);
  });

  it("blocks unknown CORS origins", async () => {
    const response = await fetch(`${server.baseUrl}/v1/overview`, {
      headers: {
        origin: "http://evil.local",
      },
    });
    expect(response.status).toBe(403);
  });

  it("keeps raw-log ingest disabled by default", async () => {
    const response = await fetch(`${server.baseUrl}/v1/ingest/raw-log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "raw-log-upload-disabled" });
  });
});
