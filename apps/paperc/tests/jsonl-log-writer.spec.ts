import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ingestBatchRequestSchema } from "../../../packages/shared-schema/src/index";
import {
  JsonlLogWriter,
  serializeJsonlEvent,
  type JsonlStorage,
} from "../../paperc-desktop/src/logging/jsonlLogWriter";
import { buildJsonlBlob } from "../../paperc-desktop/src/logging/jsonlExport";

class MemoryJsonlStorage implements JsonlStorage {
  private readonly map = new Map<string, string[]>();

  async read(sessionId: string): Promise<string[]> {
    return this.map.get(sessionId) ?? [];
  }

  async append(sessionId: string, line: string): Promise<void> {
    this.map.set(sessionId, [...(this.map.get(sessionId) ?? []), line]);
  }
}

describe("JSONL log writer", () => {
  it("serializes one event per line", () => {
    const line = serializeJsonlEvent({ eventId: "evt-1", eventType: "x" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("preserves session lines across writer restart", async () => {
    const storage = new MemoryJsonlStorage();
    const firstWriter = new JsonlLogWriter(storage);
    await firstWriter.appendEvent("session-a", { eventId: "evt-1" });

    const secondWriter = new JsonlLogWriter(storage);
    const lines = await secondWriter.readSession("session-a");
    expect(lines).toHaveLength(1);
  });

  it("keeps local logging when backend is offline", async () => {
    const storage = new MemoryJsonlStorage();
    const writer = new JsonlLogWriter(storage);
    await writer.appendEvent("session-offline", { eventId: "evt-offline", eventType: "offline" });
    const lines = await writer.readSession("session-offline");
    expect(lines).toHaveLength(1);
  });

  it("exports JSONL that round-trips into ingest fixture validator", async () => {
    const fixture = JSON.parse(
      readFileSync("services/api/tests/fixtures/ingest-batches/paperc-minimal.json", "utf8"),
    );
    const writer = new JsonlLogWriter(new MemoryJsonlStorage());
    for (const event of fixture.events) {
      await writer.appendEvent(fixture.session.sourceSessionId, event);
    }

    const lines = await writer.readSession(fixture.session.sourceSessionId);
    const blob = buildJsonlBlob(lines);
    const text = await blob.text();
    const events = text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));

    const parsed = ingestBatchRequestSchema.parse({
      ...fixture,
      events,
    });
    expect(parsed.events).toHaveLength(fixture.events.length);
  });
});
