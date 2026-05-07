import { afterEach, describe, expect, it } from "vitest";

import { startApiServer, type StartedApiServer } from "../src/index";

const servers: StartedApiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("api server", () => {
  it("serves health and sync endpoints", async () => {
    const server = await startApiServer(0);
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${address}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      storage: expect.any(String),
    });

    const sync = await fetch(`${address}/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          objectType: "deck_snapshot",
          objectId: "deck-1",
          payload: { name: "Azorius Control" },
          dirty: true,
          lastError: null,
        },
      ]),
    });

    expect(sync.status).toBe(200);
    await expect(sync.json()).resolves.toMatchObject({
      sessionMode: "anonymous",
      accepted: [expect.objectContaining({ objectId: "deck-1" })],
    });
  });

  it("serves validated archidekt imports and rejects malformed sync payloads", async () => {
    const server = await startApiServer(0, {
      archidektFetcher: async (deckId) => ({
        source: "archidekt",
        deckId,
        name: "Boros Convoke",
        updatedAt: "2026-05-06T22:30:00Z",
        cards: [{ name: "Knight-Errant of Eos", quantity: 4, category: "mainboard" }],
      }),
    });
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;

    const deck = await fetch(`${address}/integrations/archidekt/deck-1`);
    expect(deck.status).toBe(200);
    await expect(deck.json()).resolves.toMatchObject({
      source: "archidekt",
      deckId: "deck-1",
    });

    const invalidSync = await fetch(`${address}/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          objectType: "deck_snapshot",
          objectId: 42,
          payload: { name: "Broken" },
          dirty: true,
          lastError: null,
        },
      ]),
    });

    expect(invalidSync.status).toBe(400);
    await expect(invalidSync.json()).resolves.toMatchObject({
      error: "invalid-request",
    });
  });

  it("maps Archidekt runtime failures to user-facing HTTP errors", async () => {
    const notFoundServer = await startApiServer(0, {
      archidektFetcher: async () => {
        throw new Error("404 deck not found");
      },
    });
    servers.push(notFoundServer);
    const notFoundAddress = `http://127.0.0.1:${notFoundServer.port}`;

    const notFound = await fetch(`${notFoundAddress}/integrations/archidekt/deck-1`);
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toMatchObject({
      error: "archidekt-deck-not-found",
    });

    const rateLimitedServer = await startApiServer(0, {
      archidektFetcher: async () => {
        throw new Error("429 rate limit reached");
      },
    });
    servers.push(rateLimitedServer);
    const rateLimitedAddress = `http://127.0.0.1:${rateLimitedServer.port}`;

    const rateLimited = await fetch(
      `${rateLimitedAddress}/integrations/archidekt/deck-1`,
    );
    expect(rateLimited.status).toBe(429);
    await expect(rateLimited.json()).resolves.toMatchObject({
      error: "archidekt-rate-limited",
    });
  });

  it("accepts a shared backend event envelope from both ArenaC and PaperC", async () => {
    const server = await startApiServer(0);
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;

    const response = await fetch(`${address}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "batch-1",
        sessions: [
          {
            sourceSessionId: "arena-session-1",
            sourceApp: "mancutg-arenac",
            sourceKind: "arena-log",
            platform: "windows",
            gameMode: "arena",
            startedAt: "2026-05-06T22:39:00Z",
          },
          {
            sourceSessionId: "paper-session-1",
            sourceApp: "mancutg-paperc",
            sourceKind: "paper-camera",
            platform: "camera-rig",
            gameMode: "paper",
            startedAt: "2026-05-06T22:39:10Z",
            streamId: "table-12",
            metadata: {
              capture: {
                tournamentId: "tournament-1",
                roundId: "round-3",
                tableId: "table-12",
                matchId: "match-2",
                gameKey: "mtg-paper",
                captureSessionId: "capture-1",
                cameraId: "cam-12",
              },
            },
          },
          {
            sourceSessionId: "backend-session-1",
            sourceApp: "mancutg-backend",
            sourceKind: "review-decision",
            platform: "server",
            gameMode: "service",
            startedAt: "2026-05-06T22:39:20Z",
          },
        ],
        events: [
          {
            eventId: "arenac-1",
            sourceApp: "mancutg-arenac",
            sourceSessionId: "arena-session-1",
            eventType: "arena.match.completed",
            occurredAt: "2026-05-06T22:40:00Z",
            matchId: "match-1",
            gameId: "game-1",
            provenance: [
              {
                sourceKind: "arena-log",
                sourceSessionId: "arena-session-1",
                parserVersion: "arena-core/1.0.0",
              },
            ],
            payload: {
              result: "win",
            },
          },
          {
            eventId: "paperc-1",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "paper-session-1",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-06T22:41:00Z",
            streamId: "table-12",
            matchId: "match-2",
            gameId: "game-2",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-1",
                cameraId: "cam-12",
                frameNo: 1024,
                modelVersion: "paper-model/0.1.0",
              },
            ],
            confidence: 0.84,
            reviewStatus: "pending",
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-3",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "capture-1",
              cameraId: "cam-12",
              observationKind: "board-state",
              details: {
                phase: "main-1",
              },
            },
          },
          {
            eventId: "backend-1",
            sourceApp: "mancutg-backend",
            sourceSessionId: "backend-session-1",
            eventType: "paperc.review.resolved",
            occurredAt: "2026-05-06T22:42:00Z",
            matchId: "match-2",
            provenance: [
              {
                sourceKind: "review-decision",
                sourceSessionId: "backend-session-1",
              },
            ],
            reviewStatus: "corrected",
            supersedesEventId: "paperc-1",
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-3",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "capture-1",
              cameraId: "cam-12",
              reviewId: "review-1",
              resolution: "corrected",
              targetEventId: "paperc-1",
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      acceptedSessionCount: 3,
      acceptedEventCount: 3,
      deduplicatedCount: 0,
      totalStoredSessions: 3,
      totalStoredEvents: 3,
      sourceApps: expect.arrayContaining([
        "mancutg-arenac",
        "mancutg-paperc",
        "mancutg-backend",
      ]),
      sourceSessionIds: expect.arrayContaining([
        "arena-session-1",
        "paper-session-1",
        "backend-session-1",
      ]),
    });
  });

  it("ingests media sessions separately from /events", async () => {
    const server = await startApiServer(0);
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;

    const response = await fetch(`${address}/media/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "media-batch-1",
        captureSession: {
          captureSessionId: "capture-1",
          sourceApp: "mancutg-paperc",
          platform: "camera-rig",
          cameraId: "cam-12",
          streamId: "table-12",
          startedAt: "2026-05-06T22:39:10Z",
          tournament: {
            tournamentId: "tournament-1",
            roundId: "round-3",
            tableId: "table-12",
            matchId: "match-2",
            gameKey: "mtg-paper",
          },
        },
        artifacts: [
          {
            artifactId: "clip-1",
            tournamentId: "tournament-1",
            roundId: "round-3",
            tableId: "table-12",
            matchId: "match-2",
            gameKey: "mtg-paper",
            captureSessionId: "capture-1",
            cameraId: "cam-12",
            artifactKind: "clip",
            uri: "s3://bucket/clip-1.mp4",
            mimeType: "video/mp4",
            capturedAt: "2026-05-06T22:40:00Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      captureSessionId: "capture-1",
      acceptedArtifactCount: 1,
      duplicateArtifactCount: 0,
      duplicateBatch: false,
    });
  });

  it("rejects event batches that reference unknown sessions", async () => {
    const server = await startApiServer(0);
    servers.push(server);
    const address = `http://127.0.0.1:${server.port}`;

    const response = await fetch(`${address}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessions: [],
        events: [
          {
            eventId: "paper-unknown",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "missing-session",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-06T22:41:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "missing-session",
              },
            ],
            payload: {
              tournamentId: "tournament-1",
              roundId: "round-3",
              tableId: "table-12",
              matchId: "match-2",
              gameKey: "mtg-paper",
              captureSessionId: "capture-1",
              cameraId: "cam-12",
              observationKind: "board-state",
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("unknown session"),
    });
  });
});
