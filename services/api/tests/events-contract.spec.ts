import { describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  eventsRoute,
} from "../src/index";

describe("eventsRoute", () => {
  it("accepts a shared event envelope from MancuTG-ArenaC and MancuTG-PaperC", () => {
    const store = createInMemoryEventStore();

    const result = eventsRoute(
      [
        {
          eventId: "arena-1",
          sourceApp: "mancutg-arenac",
          eventType: "arena.match.finished",
          occurredAt: "2026-05-06T22:50:00Z",
          payload: {
            matchId: "match-1",
            result: "win",
          },
        },
        {
          eventId: "paper-1",
          sourceApp: "mancutg-paperc",
          eventType: "paper.round.captured",
          occurredAt: "2026-05-06T22:51:00Z",
          payload: {
            roundId: "round-4",
            table: "12",
          },
        },
      ],
      store,
    );

    expect(result.acceptedCount).toBe(2);
    expect(result.deduplicatedCount).toBe(0);
    expect(result.totalStored).toBe(2);
    expect(result.sourceApps).toEqual([
      "mancutg-arenac",
      "mancutg-paperc",
    ]);
  });

  it("deduplicates repeated events by source app and event id", () => {
    const store = createInMemoryEventStore();

    eventsRoute(
      [
        {
          eventId: "arena-1",
          sourceApp: "mancutg-arenac",
          eventType: "arena.match.finished",
          occurredAt: "2026-05-06T22:50:00Z",
          payload: { matchId: "match-1" },
        },
      ],
      store,
    );

    const result = eventsRoute(
      [
        {
          eventId: "arena-1",
          sourceApp: "mancutg-arenac",
          eventType: "arena.match.finished",
          occurredAt: "2026-05-06T22:50:00Z",
          payload: { matchId: "match-1" },
        },
      ],
      store,
    );

    expect(result.acceptedCount).toBe(1);
    expect(result.deduplicatedCount).toBe(1);
    expect(result.totalStored).toBe(1);
  });
});
