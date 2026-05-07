import { describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  eventsRoute,
} from "../src/index";
import {
  ingestBatchResponseSchema,
} from "../../../packages/shared-schema/src/index";

function papercSession(sourceSessionId: string) {
  return {
    sourceSessionId,
    sourceApp: "mancutg-paperc" as const,
    sourceKind: "paper-camera" as const,
    platform: "camera-rig-a",
    gameMode: "paper" as const,
    startedAt: "2026-05-06T22:41:00Z",
    streamId: "table-12",
    metadata: {
      capture: {
        tournamentId: "tournament-1",
        roundId: "round-4",
        tableId: "table-12",
        matchId: "match-2",
        gameKey: "mtg-paper",
        captureSessionId: sourceSessionId,
        cameraId: "cam-a",
      },
    },
  };
}

describe("eventsRoute", () => {
  it("accepts a shared batch envelope from MancuTG-ArenaC, MancuTG-PaperC, and MancuTG-backend", () => {
    const store = createInMemoryEventStore();

    const result = eventsRoute(
      {
        idempotencyKey: "batch-1",
        sessions: [
          {
            sourceSessionId: "arena-session-1",
            sourceApp: "mancutg-arenac",
            sourceKind: "arena-log",
            platform: "windows",
            gameMode: "arena",
            startedAt: "2026-05-06T22:40:00Z",
          },
          papercSession("paper-session-1"),
          {
            sourceSessionId: "backend-session-1",
            sourceApp: "mancutg-backend",
            sourceKind: "backend-process",
            platform: "server",
            gameMode: "service",
            startedAt: "2026-05-06T22:42:00Z",
          },
        ],
        events: [
          {
            eventId: "arena-1",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "arena-session-1",
            eventType: "arena.match.finished",
            occurredAt: "2026-05-06T22:50:00Z",
            matchId: "match-1",
            gameId: "game-1",
            streamId: "arena-stream-1",
            provenance: [
              {
                sourceKind: "arena-log",
                sourceSessionId: "arena-session-1",
                parserVersion: "arena-parser/0.1.0",
              },
            ],
            payload: {
              result: "win",
            },
          },
          {
            eventId: "paper-1",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "paper-session-1",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-06T22:51:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-1",
                cameraId: "cam-a",
                frameNo: 120,
                modelVersion: "paper-model/0.1.0",
              },
            ],
            confidence: 0.84,
            reviewStatus: "pending",
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-4",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "paper-session-1",
              cameraId: "cam-a",
              observationKind: "board-state",
              details: {
                round: 3,
                table: 12,
              },
            },
          },
          {
            eventId: "backend-1",
            sourceApp: "mancutg-backend",
            sourceSessionId: "backend-session-1",
            eventType: "paperc.review.resolved",
            occurredAt: "2026-05-06T22:52:00Z",
            supersedesEventId: "paper-1",
            provenance: [
              {
                sourceKind: "review-decision",
                sourceSessionId: "backend-session-1",
              },
            ],
            reviewStatus: "corrected",
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-4",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "paper-session-1",
              cameraId: "cam-a",
              reviewId: "review-1",
              resolution: "confirmed",
              targetEventId: "paper-1",
              correctedFields: {},
            },
          },
        ],
      },
      store,
    );

    expect(result.acceptedSessionCount).toBe(3);
    expect(result.acceptedEventCount).toBe(3);
    expect(result.deduplicatedCount).toBe(0);
    expect(result.duplicateBatch).toBe(false);
    expect(result.totalStoredSessions).toBe(3);
    expect(result.totalStoredEvents).toBe(3);
    expect(result.sourceApps).toEqual(
      expect.arrayContaining([
        "mancutg-arenac",
        "mancutg-backend",
        "mancutg-paperc",
      ]),
    );
    expect(result.sourceSessionIds).toEqual([
      "arena-session-1",
      "paper-session-1",
      "backend-session-1",
    ]);
  });

  it("deduplicates repeated events by source app, session, and event id", () => {
    const store = createInMemoryEventStore();

    eventsRoute(
      {
        sessions: [
          {
            sourceSessionId: "arena-session-1",
            sourceApp: "mancutg-arenac",
            sourceKind: "arena-log",
            platform: "windows",
            gameMode: "arena",
            startedAt: "2026-05-06T22:40:00Z",
          },
        ],
        events: [
          {
            eventId: "arena-1",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "arena-session-1",
            eventType: "arena.match.finished",
            occurredAt: "2026-05-06T22:50:00Z",
            provenance: [
              {
                sourceKind: "arena-log",
                sourceSessionId: "arena-session-1",
              },
            ],
            payload: { matchId: "match-1" },
          },
        ],
      },
      store,
    );

    const result = eventsRoute(
      {
        sessions: [],
        events: [
          {
            eventId: "arena-1",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "arena-session-1",
            eventType: "arena.match.finished",
            occurredAt: "2026-05-06T22:50:00Z",
            provenance: [
              {
                sourceKind: "arena-log",
                sourceSessionId: "arena-session-1",
              },
            ],
            payload: { matchId: "match-1" },
          },
        ],
      },
      store,
    );

    expect(result.acceptedSessionCount).toBe(0);
    expect(result.acceptedEventCount).toBe(0);
    expect(result.deduplicatedCount).toBe(1);
    expect(result.totalStoredEvents).toBe(1);
  });

  it("keeps the same event id distinct across different sessions", () => {
    const store = createInMemoryEventStore();

    const result = eventsRoute(
      {
        sessions: [
          papercSession("paper-session-1"),
          papercSession("paper-session-2"),
        ],
        events: [
          {
            eventId: "paper-1",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "paper-session-1",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-06T22:50:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-1",
                cameraId: "cam-a",
              },
            ],
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-4",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "paper-session-1",
              cameraId: "cam-a",
              observationKind: "board-state",
              details: {},
            },
          },
          {
            eventId: "paper-1",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "paper-session-2",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-06T22:55:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-2",
                cameraId: "cam-a",
              },
            ],
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-4",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "paper-session-2",
              cameraId: "cam-a",
              observationKind: "board-state",
              details: {},
            },
          },
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
    const store = createInMemoryEventStore();

    const first = {
      idempotencyKey: "batch-1",
      sessions: [
        {
          sourceSessionId: "arena-session-1",
          sourceApp: "mancutg-arenac",
          sourceKind: "arena-log",
          platform: "windows",
          gameMode: "arena",
          startedAt: "2026-05-06T22:40:00Z",
        },
      ],
      events: [
        {
          eventId: "arena-1",
          sourceApp: "mancutg-arenac",
          sourceSessionId: "arena-session-1",
          eventType: "arena.match.finished",
          occurredAt: "2026-05-06T22:50:00Z",
          provenance: [
            {
              sourceKind: "arena-log",
              sourceSessionId: "arena-session-1",
            },
          ],
          payload: { matchId: "match-1" },
        },
      ],
    };

    const firstResult = eventsRoute(first, store);
    const secondResult = eventsRoute(first, store);

    expect(firstResult.duplicateBatch).toBe(false);
    expect(secondResult.duplicateBatch).toBe(true);
    expect(secondResult.acceptedEventCount).toBe(0);
    expect(secondResult.deduplicatedCount).toBe(1);
    expect(secondResult.totalStoredEvents).toBe(1);
  });

  it("rejects events that reference unknown sessions", () => {
    const store = createInMemoryEventStore();

    expect(() =>
      eventsRoute(
        {
          sessions: [],
          events: [
            {
              eventId: "paper-1",
              sourceApp: "mancutg-paperc",
              sourceSessionId: "missing-session",
              eventType: "paperc.observation.detected",
              occurredAt: "2026-05-06T22:51:00Z",
              provenance: [
                {
                  sourceKind: "paper-camera",
                  sourceSessionId: "missing-session",
                  cameraId: "cam-a",
                },
              ],
              payload: {
                tournamentId: "tournament-1",
                roundId: "round-4",
                tableId: "table-12",
                matchId: "match-2",
                gameKey: "mtg-paper",
                captureSessionId: "missing-session",
                cameraId: "cam-a",
                observationKind: "board-state",
                details: {},
              },
            },
          ],
        },
        store,
      ),
    ).toThrow(/unknown session/);
  });

  it("parses v1 ingest response contract with partial errors", () => {
    const parsed = ingestBatchResponseSchema.parse({
      batchId: "batch_01",
      accepted: 8,
      duplicates: 2,
      rejected: 1,
      errors: [
        {
          eventId: "paper-session-123-obs-3-0",
          code: "invalid_payload",
          message: "payload.zone is required",
        },
      ],
    });

    expect(parsed.accepted).toBe(8);
    expect(parsed.duplicates).toBe(2);
    expect(parsed.rejected).toBe(1);
    expect(parsed.errors).toHaveLength(1);
  });
});
