import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  createSqliteStore,
  eventsPullRoute,
  eventsRoute,
  startApiServer,
  type BackendStoreLike,
  type SqliteEventStore,
  type StartedApiServer,
} from "../src/index";

const openStores: SqliteEventStore[] = [];
const servers: StartedApiServer[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function sqliteStore(): SqliteEventStore {
  const store = createSqliteStore(":memory:");
  openStores.push(store);
  return store;
}

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

function arenaEvent(
  sourceSessionId: string,
  eventId: string,
  payload: Record<string, unknown> = {},
) {
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

function seedEvents(store: BackendStoreLike, count: number): string[] {
  const eventIds = Array.from({ length: count }, (_, index) => `event-${index + 1}`);
  eventsRoute(
    {
      sessions: [arenaSession("arena-session-1")],
      events: eventIds.map((eventId, index) =>
        arenaEvent("arena-session-1", eventId, {
          tournamentId: index % 2 === 0 ? "tour-even" : "tour-odd",
        }),
      ),
    },
    store,
  );
  return eventIds;
}

function drainAllPages(
  store: BackendStoreLike,
  limit: number,
  tournamentId?: string,
): { eventIds: string[]; pageSizes: number[] } {
  const eventIds: string[] = [];
  const pageSizes: number[] = [];
  let cursor = 0;

  for (;;) {
    const page = eventsPullRoute({ cursor, limit, tournamentId }, store);
    if (page.events.length === 0) {
      expect(page.nextCursor).toBe(cursor);
      break;
    }
    pageSizes.push(page.events.length);
    eventIds.push(...page.events.map((event) => event.eventId));
    expect(page.nextCursor).toBeGreaterThan(cursor);
    cursor = page.nextCursor;
  }

  return { eventIds, pageSizes };
}

describe("eventsPullRoute", () => {
  for (const flavour of ["sqlite", "json"] as const) {
    const makeStore = (): BackendStoreLike =>
      flavour === "sqlite" ? sqliteStore() : createInMemoryEventStore();

    describe(`${flavour} store`, () => {
      it("pages through all events in stable order with no gaps or duplicates", () => {
        const store = makeStore();
        const seeded = seedEvents(store, 25);

        const { eventIds, pageSizes } = drainAllPages(store, 10);

        expect(pageSizes).toEqual([10, 10, 5]);
        expect(eventIds).toEqual(seeded);
        expect(new Set(eventIds).size).toBe(seeded.length);
      });

      it("re-reading a page yields the identical slice (stable ordering)", () => {
        const store = makeStore();
        seedEvents(store, 12);

        const first = eventsPullRoute({ cursor: 0, limit: 5 }, store);
        const again = eventsPullRoute({ cursor: 0, limit: 5 }, store);

        expect(again).toEqual(first);
        expect(first.events.map((event) => event.eventId)).toEqual([
          "event-1",
          "event-2",
          "event-3",
          "event-4",
          "event-5",
        ]);
      });

      it("filters by tournamentId while keeping pagination gap- and duplicate-free", () => {
        const store = makeStore();
        const seeded = seedEvents(store, 20);
        const expected = seeded.filter((_, index) => index % 2 === 0);

        const { eventIds } = drainAllPages(store, 3, "tour-even");

        expect(eventIds).toEqual(expected);
        expect(new Set(eventIds).size).toBe(expected.length);
      });

      it("events appended between pages are picked up by the next pull", () => {
        const store = makeStore();
        seedEvents(store, 4);

        const firstPage = eventsPullRoute({ cursor: 0, limit: 10 }, store);
        expect(firstPage.events).toHaveLength(4);

        eventsRoute(
          {
            sessions: [],
            events: [arenaEvent("arena-session-1", "late-event")],
          },
          store,
        );

        const secondPage = eventsPullRoute(
          { cursor: firstPage.nextCursor, limit: 10 },
          store,
        );
        expect(secondPage.events.map((event) => event.eventId)).toEqual(["late-event"]);
      });

      it("applies defaults and rejects malformed query values", () => {
        const store = makeStore();
        seedEvents(store, 2);

        const withDefaults = eventsPullRoute({}, store);
        expect(withDefaults.events).toHaveLength(2);

        expect(() => eventsPullRoute({ cursor: "not-a-number" }, store)).toThrow();
        expect(() => eventsPullRoute({ cursor: "-1" }, store)).toThrow();
        expect(() => eventsPullRoute({ limit: "0" }, store)).toThrow();
      });

      it("never returns referee-only analysis findings through the anonymous pull feed", () => {
        const store = makeStore();
        eventsRoute(
          {
            sessions: [arenaSession("arena-session-secret")],
            events: [
              arenaEvent("arena-session-secret", "normal-1", {
                tournamentId: "tour-secret",
              }),
              {
                eventId: "finding-secret-1",
                sourceApp: "mancutg-arenac" as const,
                sourceSessionId: "arena-session-secret",
                eventType: "analysis.finding.raised",
                occurredAt: "2026-05-06T22:55:00Z",
                provenance: [
                  {
                    sourceKind: "arena-log" as const,
                    sourceSessionId: "arena-session-secret",
                  },
                ],
                payload: {
                  tournamentId: "tour-secret",
                  audience: "referee-only",
                  description: "possible missed trigger",
                  ruleRefs: ["603.2"],
                },
              },
            ],
          },
          store,
        );

        // Both an unscoped pull and a tournament-targeted pull must omit the
        // finding entirely (the whole point of referee-only visibility), while
        // still returning ordinary events.
        for (const query of [{}, { tournamentId: "tour-secret" }]) {
          const result = eventsPullRoute(query, store);
          const eventIds = result.events.map((event) => event.eventId);
          expect(eventIds).toContain("normal-1");
          expect(eventIds).not.toContain("finding-secret-1");
          expect(
            result.events.some((event) =>
              event.eventType.startsWith("analysis."),
            ),
          ).toBe(false);
        }
      });
    });
  }

  it("serves GET /events over HTTP with cursor pagination", async () => {
    const store = sqliteStore();
    seedEvents(store, 7);

    const server = await startApiServer(0, { eventStore: store });
    servers.push(server);

    const collected: string[] = [];
    let cursor = 0;
    for (;;) {
      const response = await fetch(
        `${server.baseUrl}/events?cursor=${cursor}&limit=3`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        events: Array<{ eventId: string }>;
        nextCursor: number;
      };
      if (body.events.length === 0) {
        expect(body.nextCursor).toBe(cursor);
        break;
      }
      collected.push(...body.events.map((event) => event.eventId));
      cursor = body.nextCursor;
    }

    expect(collected).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
      "event-7",
    ]);

    const filtered = await fetch(
      `${server.baseUrl}/events?cursor=0&limit=100&tournamentId=tour-odd`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as {
      events: Array<{ eventId: string; payload: { tournamentId?: string } }>;
    };
    expect(filteredBody.events.map((event) => event.eventId)).toEqual([
      "event-2",
      "event-4",
      "event-6",
    ]);

    const invalid = await fetch(`${server.baseUrl}/events?cursor=abc`);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "invalid-request" });
  });
});
