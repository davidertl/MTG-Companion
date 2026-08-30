import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyBackendEventBatch,
  createBackendStore,
  createSqliteStore,
  eventsRoute,
  mediaSessionsRoute,
  type SqliteEventStore,
} from "../src/index";

const tempPaths: string[] = [];
const openStores: SqliteEventStore[] = [];

function tempSqlitePath(name: string): string {
  const path = join(tmpdir(), `${name}-${Date.now()}-${Math.random()}.sqlite`);
  tempPaths.push(path);
  return path;
}

function trackStore(store: SqliteEventStore): SqliteEventStore {
  openStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed by the test
    }
  }
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function arenaSession(sourceSessionId: string) {
  return {
    sourceSessionId,
    sourceApp: "mancutg-arenac" as const,
    sourceKind: "arena-log" as const,
    platform: "windows",
    gameMode: "arena" as const,
    startedAt: "2026-05-06T22:40:00Z",
  };
}

function arenaEvent(sourceSessionId: string, eventId: string, payload: Record<string, unknown> = {}) {
  return {
    eventId,
    sourceApp: "mancutg-arenac" as const,
    sourceSessionId,
    eventType: "arena.match.finished",
    occurredAt: "2026-05-06T22:50:00Z",
    provenance: [
      {
        sourceKind: "arena-log" as const,
        sourceSessionId,
      },
    ],
    payload,
  };
}

function mediaRequest(idempotencyKey?: string) {
  return {
    ...(idempotencyKey ? { idempotencyKey } : {}),
    captureSession: {
      captureSessionId: "capture-1",
      sourceApp: "mancutg-paperc" as const,
      platform: "camera-rig-a",
      cameraId: "cam-a",
      streamId: "table-12",
      startedAt: "2026-05-07T00:10:00Z",
      tournament: {
        tournamentId: "tour-1",
        roundId: "round-2",
        tableId: "table-12",
        matchId: "match-12",
        gameKey: "mtg-paper",
      },
    },
    artifacts: [
      {
        artifactId: "clip-1",
        tournamentId: "tour-1",
        roundId: "round-2",
        tableId: "table-12",
        matchId: "match-12",
        gameKey: "mtg-paper",
        captureSessionId: "capture-1",
        cameraId: "cam-a",
        artifactKind: "clip" as const,
        uri: "s3://bucket/clip-1.mp4",
        mimeType: "video/mp4",
        capturedAt: "2026-05-07T00:11:00Z",
      },
    ],
  };
}

describe("sqlite store", () => {
  it("deduplicates repeated events by source app, session, and event id", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    const first = eventsRoute(
      {
        sessions: [arenaSession("arena-session-1")],
        events: [arenaEvent("arena-session-1", "arena-1", { matchId: "match-1" })],
      },
      store,
    );
    expect(first.acceptedEventCount).toBe(1);

    const second = eventsRoute(
      {
        sessions: [],
        events: [arenaEvent("arena-session-1", "arena-1", { matchId: "match-1" })],
      },
      store,
    );

    expect(second.acceptedSessionCount).toBe(0);
    expect(second.acceptedEventCount).toBe(0);
    expect(second.deduplicatedCount).toBe(1);
    expect(second.totalStoredEvents).toBe(1);
  });

  it("keeps the same event id distinct across different sessions", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    const result = eventsRoute(
      {
        sessions: [arenaSession("arena-session-1"), arenaSession("arena-session-2")],
        events: [
          arenaEvent("arena-session-1", "shared-id"),
          arenaEvent("arena-session-2", "shared-id"),
        ],
      },
      store,
    );

    expect(result.acceptedSessionCount).toBe(2);
    expect(result.acceptedEventCount).toBe(2);
    expect(result.deduplicatedCount).toBe(0);
    expect(result.totalStoredEvents).toBe(2);
  });

  it("treats a repeated idempotency key as a duplicate batch", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    const batch = {
      idempotencyKey: "batch-1",
      sessions: [arenaSession("arena-session-1")],
      events: [arenaEvent("arena-session-1", "arena-1")],
    };

    const first = eventsRoute(batch, store);
    const second = eventsRoute(batch, store);

    expect(first.duplicateBatch).toBe(false);
    expect(second.duplicateBatch).toBe(true);
    expect(second.acceptedEventCount).toBe(0);
    expect(second.deduplicatedCount).toBe(1);
    expect(second.totalStoredEvents).toBe(1);
  });

  it("scopes event and media idempotency keys separately (JSON store parity)", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    const eventResult = eventsRoute(
      {
        idempotencyKey: "shared-key",
        sessions: [arenaSession("arena-session-1")],
        events: [arenaEvent("arena-session-1", "arena-1")],
      },
      store,
    );
    expect(eventResult.duplicateBatch).toBe(false);

    const mediaResult = mediaSessionsRoute(mediaRequest("shared-key"), store);
    expect(mediaResult.duplicateBatch).toBe(false);
    expect(mediaResult.acceptedArtifactCount).toBe(1);
  });

  it("rejects events for unknown sessions and rolls the whole batch back", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    eventsRoute(
      {
        sessions: [arenaSession("arena-session-1")],
        events: [arenaEvent("arena-session-1", "arena-1")],
      },
      store,
    );

    expect(() =>
      eventsRoute(
        {
          sessions: [],
          events: [
            arenaEvent("arena-session-1", "arena-2"),
            arenaEvent("missing-session", "arena-3"),
          ],
        },
        store,
      ),
    ).toThrow(/unknown session/);

    // The valid event in the failed batch must not have been committed.
    expect(store.countEvents()).toBe(1);
  });

  it("deduplicates media artifacts by captureSessionId and artifactId", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    const first = mediaSessionsRoute(mediaRequest(), store);
    expect(first.createdSession).toBe(true);
    expect(first.acceptedArtifactCount).toBe(1);

    const second = mediaSessionsRoute(mediaRequest(), store);
    expect(second.createdSession).toBe(false);
    expect(second.acceptedArtifactCount).toBe(0);
    expect(second.duplicateArtifactCount).toBe(1);
    expect(second.totalStoredMediaArtifacts).toBe(1);
  });

  it("deduplicates repeated media batches via idempotency key", () => {
    const store = trackStore(createSqliteStore(":memory:"));

    mediaSessionsRoute(mediaRequest("media-batch-1"), store);
    const second = mediaSessionsRoute(mediaRequest("media-batch-1"), store);

    expect(second.duplicateBatch).toBe(true);
    expect(second.acceptedArtifactCount).toBe(0);
    expect(second.duplicateArtifactCount).toBe(1);
  });

  it("persists sessions, events, media, and batch keys across restarts", () => {
    const path = tempSqlitePath("mancutg-backend-store");

    const store = trackStore(createSqliteStore(path));
    applyBackendEventBatch(store, {
      idempotencyKey: "batch-1",
      sessions: [arenaSession("arena-session-1")],
      events: [
        arenaEvent("arena-session-1", "arena-1", { result: "win" }),
        arenaEvent("arena-session-1", "arena-2", { result: "loss" }),
      ],
    });
    mediaSessionsRoute(mediaRequest("media-batch-1"), store);
    store.close();

    const reopened = trackStore(createSqliteStore(path));
    expect(reopened.countSessions()).toBe(1);
    expect(reopened.countEvents()).toBe(2);
    expect(reopened.countMediaSessions()).toBe(1);
    expect(reopened.countMediaArtifacts()).toBe(1);

    // Cursor continuity: previously stored events remain readable in order.
    const page = reopened.readEventsAfter(0, 10);
    expect(page.map((entry) => entry.event.eventId)).toEqual(["arena-1", "arena-2"]);
    expect(page[0].cursor).toBeLessThan(page[1].cursor);

    // Dedupe identity survives restart.
    const replay = eventsRoute(
      {
        sessions: [],
        events: [arenaEvent("arena-session-1", "arena-1", { result: "win" })],
      },
      reopened,
    );
    expect(replay.deduplicatedCount).toBe(1);
    expect(replay.totalStoredEvents).toBe(2);

    // Batch idempotency key survives restart too.
    const replayBatch = eventsRoute(
      {
        idempotencyKey: "batch-1",
        sessions: [],
        events: [arenaEvent("arena-session-1", "arena-3")],
      },
      reopened,
    );
    expect(replayBatch.duplicateBatch).toBe(true);
    expect(replayBatch.totalStoredEvents).toBe(2);
  });

  it("is selected by createBackendStore for non-.json paths and keeps JSON for .json paths", () => {
    const sqlitePath = tempSqlitePath("selection");
    const sqliteStore = createBackendStore(sqlitePath);
    expect(typeof (sqliteStore as SqliteEventStore).readEventsAfter).toBe("function");
    trackStore(sqliteStore as SqliteEventStore);

    const jsonPath = join(tmpdir(), `selection-${Date.now()}-${Math.random()}.json`);
    tempPaths.push(jsonPath);
    const jsonStore = createBackendStore(jsonPath);
    expect(jsonStore).toMatchObject({ filePath: jsonPath, sessions: [], events: [] });
  });
});
