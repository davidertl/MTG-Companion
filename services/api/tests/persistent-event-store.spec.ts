import { describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyBackendEventBatch,
  createPersistentEventStore,
} from "../src/index";

function tempStorePath(name: string): string {
  return join(tmpdir(), `${name}-${Date.now()}-${Math.random()}.json`);
}

describe("persistent event store", () => {
  it("persists sessions and events across store reloads", () => {
    const storePath = tempStorePath("mancutg-backend-store");
    const store = createPersistentEventStore(storePath);

    applyBackendEventBatch(store, {
      idempotencyKey: "batch-1",
      sessions: [
        {
          sourceSessionId: "arena-session-1",
          sourceApp: "mancutg-arenac",
          sourceKind: "arena-log",
          platform: "windows",
          gameMode: "arena",
          startedAt: "2026-05-07T00:30:00Z",
        },
      ],
      events: [
        {
          eventId: "arena-1",
          sourceApp: "mancutg-arenac",
          sourceSessionId: "arena-session-1",
          eventType: "arena.match.completed",
          occurredAt: "2026-05-07T00:31:00Z",
          matchId: "match-1",
          gameId: "game-1",
          provenance: [
            {
              sourceKind: "arena-log",
              sourceSessionId: "arena-session-1",
            },
          ],
          payload: {
            result: "win",
          },
        },
      ],
    });

    expect(existsSync(storePath)).toBe(true);

    const reloaded = createPersistentEventStore(storePath);
    expect(reloaded.sessions).toHaveLength(1);
    expect(reloaded.events).toHaveLength(1);
    expect(reloaded.events[0].sourceSessionId).toBe("arena-session-1");

    rmSync(storePath, { force: true });
  });
});
