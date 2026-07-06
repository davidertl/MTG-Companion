import { describe, expect, it } from "vitest";

import { Outbox, type FetchLike, type FetchResult } from "../src/sync/outbox";
import { MemoryStore } from "../src/state/persistence";
import { buildGameEventBatch, createGameLogState, gameLogReducer } from "../src/state/gameLog";
import { playLand } from "../src/state/actions";
import type { PaperGameSetup } from "../src/state/gameLog";
import type { BackendEventBatchEnvelope } from "../../../packages/shared-schema/src/index";

const setup: PaperGameSetup = {
  sourceSessionId: "paper-session-1",
  captureSessionId: "capture-1",
  cameraId: "manual",
  platform: "paperc-web",
  startedAt: "2026-07-06T10:00:00.000Z",
  format: "modern",
  players: { player1: "Ann", player2: "Bob" },
  tournament: {
    tournamentId: "local",
    roundId: "local",
    tableId: "table-1",
    matchId: "match-1",
    gameKey: "mtg-paper",
  },
};

function sampleBatch(idempotencyKey: string): BackendEventBatchEnvelope {
  let state = createGameLogState("player1");
  state = gameLogReducer(state, {
    type: "log",
    action: playLand("player1", "Forest"),
    eventId: "evt-1",
    occurredAt: "2026-07-06T10:00:00.000Z",
  });
  return buildGameEventBatch(state.entries, setup, idempotencyKey);
}

type RecordedCall = { url: string; idempotencyKey: string; body: string };

function recordingFetch(
  responder: (call: number) => FetchResult,
): { fetchFn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, idempotencyKey: init.headers["idempotency-key"], body: init.body });
    return responder(calls.length);
  };
  return { fetchFn, calls };
}

describe("PaperC sync outbox", () => {
  it("posts a queued batch to /events once on success", async () => {
    const { fetchFn, calls } = recordingFetch(() => ({ ok: true, status: 200 }));
    const outbox = new Outbox({ endpoint: "http://api.test", fetchFn, store: new MemoryStore() });

    outbox.enqueue(sampleBatch("batch-a"));
    const summary = await outbox.flush();

    expect(summary.sent).toBe(1);
    expect(summary.remaining).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://api.test/events");
    expect(calls[0].idempotencyKey).toBe("batch-a");

    // A second flush does not repost an already-sent batch.
    const second = await outbox.flush();
    expect(second.sent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("retries with backoff on failure using a stable idempotencyKey", async () => {
    let clock = 0;
    // First attempt fails (offline), the retry succeeds.
    const { fetchFn, calls } = recordingFetch((n) =>
      n === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 },
    );
    const outbox = new Outbox({
      endpoint: "http://api.test",
      fetchFn,
      store: new MemoryStore(),
      now: () => clock,
      baseBackoffMs: 1000,
    });

    outbox.enqueue(sampleBatch("batch-b"));

    const first = await outbox.flush();
    expect(first.failed).toBe(1);
    expect(outbox.pendingCount()).toBe(1);

    // Not yet due -> skipped, no extra request.
    const tooEarly = await outbox.flush();
    expect(tooEarly.skipped).toBe(1);
    expect(calls).toHaveLength(1);

    // Advance past the backoff window -> retry succeeds.
    clock = 5000;
    const retry = await outbox.flush();
    expect(retry.sent).toBe(1);
    expect(calls).toHaveLength(2);
    // idempotencyKey identical across the retry -> server dedups.
    expect(calls[0].idempotencyKey).toBe("batch-b");
    expect(calls[1].idempotencyKey).toBe("batch-b");
  });

  it("dedups re-enqueue of a known idempotencyKey", async () => {
    const { fetchFn, calls } = recordingFetch(() => ({ ok: true, status: 200 }));
    const outbox = new Outbox({ endpoint: "http://api.test", fetchFn, store: new MemoryStore() });

    expect(outbox.enqueue(sampleBatch("batch-c"))).toBe(true);
    expect(outbox.enqueue(sampleBatch("batch-c"))).toBe(false);
    expect(outbox.pendingCount()).toBe(1);

    await outbox.flush();
    // Even after send, the key is remembered -> still deduped.
    expect(outbox.enqueue(sampleBatch("batch-c"))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("persists the queue across instances via the shared store", async () => {
    const store = new MemoryStore();
    const first = new Outbox({
      endpoint: "http://api.test",
      fetchFn: async () => ({ ok: false, status: 500 }),
      store,
      now: () => 1000,
    });
    first.enqueue(sampleBatch("batch-d"));
    await first.flush();

    // A fresh instance rehydrates the pending batch from storage.
    const { fetchFn, calls } = recordingFetch(() => ({ ok: true, status: 200 }));
    const second = new Outbox({ endpoint: "http://api.test", fetchFn, store, now: () => 10_000_000 });
    expect(second.pendingCount()).toBe(1);
    const summary = await second.flush();
    expect(summary.sent).toBe(1);
    expect(calls[0].idempotencyKey).toBe("batch-d");
  });
});
