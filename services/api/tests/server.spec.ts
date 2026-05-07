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
    await expect(health.json()).resolves.toEqual({ status: "ok" });

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
            eventType: "paper.round.completed",
            occurredAt: "2026-05-06T22:41:00Z",
            streamId: "table-12",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-1",
                cameraId: "cam-12",
                frameNo: 1024,
              },
            ],
            payload: {
              round: 3,
              table: 12,
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      acceptedSessionCount: 2,
      acceptedEventCount: 2,
      deduplicatedCount: 0,
      totalStoredSessions: 2,
      totalStoredEvents: 2,
      sourceApps: ["mancutg-arenac", "mancutg-paperc"],
      sourceSessionIds: ["arena-session-1", "paper-session-1"],
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
            eventType: "paper.round.completed",
            occurredAt: "2026-05-06T22:41:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "missing-session",
              },
            ],
            payload: {
              round: 3,
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
