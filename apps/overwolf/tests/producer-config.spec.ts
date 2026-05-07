import { describe, expect, it } from "vitest";

import { ingestBatchRequestSchema } from "../../../packages/shared-schema/src/events";
import fixture from "../../../services/api/tests/fixtures/ingest-batches/arenac-minimal.json";
import {
  createArenaIngestBatch,
  DEFAULT_ARENA_PRODUCER_CONFIG,
} from "../src/producer-config";

describe("Arena producer config + ingest wiring", () => {
  it("uses expected producer defaults", () => {
    expect(DEFAULT_ARENA_PRODUCER_CONFIG).toEqual({
      backendUrl: "http://127.0.0.1:18080",
      producerToken: null,
      uploadRawLogs: false,
      uploadNormalizedEvents: true,
    });
  });

  it("emits contract-valid ingest batch payload", () => {
    const payload = createArenaIngestBatch(fixture);
    const parsed = ingestBatchRequestSchema.parse(payload);
    expect(parsed.idempotencyKey).toBe(fixture.idempotencyKey);
    expect(parsed.events.length).toBeGreaterThan(0);
  });
});
