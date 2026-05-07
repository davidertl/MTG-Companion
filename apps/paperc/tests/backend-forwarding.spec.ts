import { describe, expect, it, vi } from "vitest";
import type { IngestBatchRequest } from "../../../packages/shared-schema/src/index";
import { BackendSyncError, postIngestBatch } from "../../paperc-desktop/src/sync/backendClient";

const batch: IngestBatchRequest = {
  idempotencyKey: "batch-1",
  producer: {
    app: "mancutg-paperc",
    version: "0.1.0",
    instanceId: "device-1",
  },
  game: {
    gameKey: "mtg-paper",
    gameFamily: "mtg",
    title: "Magic: The Gathering",
    mode: "paper",
  },
  session: {
    sourceSessionId: "session-1",
    startedAt: "2026-05-07T01:00:00.000Z",
    source: "camera",
    metadata: {},
  },
  events: [
    {
      eventId: "e1",
      sourceEventId: "e1",
      eventType: "paperc.observation.detected",
      occurredAt: "2026-05-07T01:00:01.000Z",
      payload: {},
      targets: [],
      provenance: { source: "camera-frame", metadata: {} },
    },
  ],
};

describe("backend forwarding", () => {
  it("accepts happy-path 200", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ batchId: "b1", accepted: 1, duplicates: 0, rejected: 0, errors: [] }), {
        status: 200,
      }),
    );
    const result = await postIngestBatch("http://example.test", batch, undefined, fetchMock as typeof fetch);
    expect(result.accepted).toBe(1);
  });

  it("throws and preserves failure info on 500 and 400", async () => {
    const fetch500 = vi.fn(async () => new Response("fail", { status: 500 }));
    await expect(
      postIngestBatch("http://example.test", batch, undefined, fetch500 as typeof fetch),
    ).rejects.toBeInstanceOf(BackendSyncError);

    const fetch400 = vi.fn(async () => new Response("bad payload", { status: 400 }));
    await expect(
      postIngestBatch("http://example.test", batch, undefined, fetch400 as typeof fetch),
    ).rejects.toBeInstanceOf(BackendSyncError);
  });

  it("keeps batch pending on timeout", async () => {
    const fetchTimeout = vi.fn(async () => {
      throw new Error("timeout");
    });
    await expect(
      postIngestBatch("http://example.test", batch, undefined, fetchTimeout as typeof fetch),
    ).rejects.toThrow("timeout");
  });

  it("replays pending queue after backend recovers", async () => {
    const calls: number[] = [];
    const fetchMock = vi.fn(async () => {
      calls.push(1);
      if (calls.length === 1) {
        return new Response("temporary failure", { status: 500 });
      }
      return new Response(
        JSON.stringify({ batchId: "b2", accepted: 1, duplicates: 0, rejected: 0, errors: [] }),
        { status: 200 },
      );
    });
    const pending: IngestBatchRequest[] = [];
    try {
      await postIngestBatch("http://example.test", batch, undefined, fetchMock as typeof fetch);
    } catch {
      pending.push(batch);
    }
    expect(pending).toHaveLength(1);

    const replayed = await postIngestBatch(
      "http://example.test",
      pending[0],
      undefined,
      fetchMock as typeof fetch,
    );
    expect(replayed.accepted).toBe(1);
  });
});
