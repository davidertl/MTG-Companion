import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  createSqliteStore,
  ForbiddenError,
  getMembershipRole,
  registerUser,
  requireRole,
  resolveStore,
  startApiServer,
  type BackendStoreLike,
  type StartedApiServer,
  type Store,
} from "../src/index";

const servers: StartedApiServer[] = [];
const closables: Array<{ close?: () => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const store of closables.splice(0)) {
    store.close?.();
  }
});

type StoreFactory = { name: string; make: () => BackendStoreLike };

const storeFactories: StoreFactory[] = [
  { name: "json", make: () => createInMemoryEventStore() },
  {
    name: "sqlite",
    make: () => {
      const store = createSqliteStore(":memory:");
      closables.push(store);
      return store;
    },
  },
];

function arenaBatch() {
  return {
    idempotencyKey: `batch-${Math.random()}`,
    sessions: [
      {
        sourceSessionId: "arena-session-1",
        sourceApp: "mancutg-arenac",
        sourceKind: "arena-log",
        platform: "windows",
        gameMode: "arena",
        startedAt: "2026-05-06T22:39:00Z",
      },
    ],
    events: [
      {
        eventId: `arena-${Math.random()}`,
        sourceApp: "mancutg-arenac",
        sourceSessionId: "arena-session-1",
        eventType: "arena.match.completed",
        occurredAt: "2026-05-06T22:40:00Z",
        provenance: [{ sourceKind: "arena-log", sourceSessionId: "arena-session-1" }],
        payload: { result: "win" },
      },
    ],
  };
}

async function registerViaHttp(baseUrl: string, displayName: string) {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { userId: string; token: string; displayName: string };
}

function authHeaders(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

describe.each(storeFactories)("auth + tournament roles ($name store)", ({ make }) => {
  it("registers, creates a tournament (creator = organizer), and assigns roles", async () => {
    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const organizer = await registerViaHttp(base, "Olivia Organizer");
    const referee = await registerViaHttp(base, "Rita Referee");
    const player = await registerViaHttp(base, "Peter Player");

    const created = await fetch(`${base}/tournaments`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({ name: "Friday Night Magic", settings: { findingVisibilityMode: "referee-only" } }),
    });
    expect(created.status).toBe(201);
    const { tournament, membership } = (await created.json()) as {
      tournament: { tournamentId: string; settings: { findingVisibilityMode: string } };
      membership: { role: string; userId: string };
    };
    expect(membership.role).toBe("organizer");
    expect(membership.userId).toBe(organizer.userId);
    expect(tournament.settings.findingVisibilityMode).toBe("referee-only");
    const tournamentId = tournament.tournamentId;

    // Organizer adds a referee.
    const addReferee = await fetch(`${base}/tournaments/${tournamentId}/members`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({ userId: referee.userId, role: "referee" }),
    });
    expect(addReferee.status).toBe(201);
    await expect(addReferee.json()).resolves.toMatchObject({
      membership: { userId: referee.userId, role: "referee" },
    });

    // Organizer adds a player.
    const addPlayer = await fetch(`${base}/tournaments/${tournamentId}/members`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({ userId: player.userId, role: "player" }),
    });
    expect(addPlayer.status).toBe(201);

    // Referee can read their own role.
    const roleResponse = await fetch(`${base}/tournaments/${tournamentId}/role`, {
      headers: authHeaders(referee.token),
    });
    expect(roleResponse.status).toBe(200);
    await expect(roleResponse.json()).resolves.toMatchObject({
      tournamentId,
      userId: referee.userId,
      role: "referee",
    });
  });

  it("forbids a player from adding members (403)", async () => {
    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const organizer = await registerViaHttp(base, "Org");
    const player = await registerViaHttp(base, "Player");
    const outsider = await registerViaHttp(base, "Outsider");

    const created = await fetch(`${base}/tournaments`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({}),
    });
    const { tournament } = (await created.json()) as { tournament: { tournamentId: string } };
    const tournamentId = tournament.tournamentId;

    await fetch(`${base}/tournaments/${tournamentId}/members`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({ userId: player.userId, role: "player" }),
    });

    const attempt = await fetch(`${base}/tournaments/${tournamentId}/members`, {
      method: "POST",
      headers: authHeaders(player.token),
      body: JSON.stringify({ userId: outsider.userId, role: "player" }),
    });
    expect(attempt.status).toBe(403);
    await expect(attempt.json()).resolves.toMatchObject({ error: "insufficient-role" });
  });

  it("rejects unauthenticated tournament routes with 401", async () => {
    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const noAuthCreate = await fetch(`${base}/tournaments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noAuthCreate.status).toBe(401);
    await expect(noAuthCreate.json()).resolves.toMatchObject({ error: "unauthorized" });

    const bogusToken = await fetch(`${base}/tournaments/anything/role`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(bogusToken.status).toBe(401);
  });

  it("keeps legacy anonymous paths working without auth (POST /events -> 200)", async () => {
    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const events = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(arenaBatch()),
    });
    expect(events.status).toBe(200);
    await expect(events.json()).resolves.toMatchObject({ acceptedEventCount: 1 });

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it("returns null role for a non-member and disables registration by default", async () => {
    // Registration off unless explicitly enabled.
    const disabled = await startApiServer(0, { eventStore: make() });
    servers.push(disabled);
    const disabledRegister = await fetch(`${disabled.baseUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Nope" }),
    });
    expect(disabledRegister.status).toBe(403);

    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const organizer = await registerViaHttp(base, "Org");
    const stranger = await registerViaHttp(base, "Stranger");
    const created = await fetch(`${base}/tournaments`, {
      method: "POST",
      headers: authHeaders(organizer.token),
      body: JSON.stringify({}),
    });
    const { tournament } = (await created.json()) as { tournament: { tournamentId: string } };

    const roleResponse = await fetch(`${base}/tournaments/${tournament.tournamentId}/role`, {
      headers: authHeaders(stranger.token),
    });
    expect(roleResponse.status).toBe(200);
    await expect(roleResponse.json()).resolves.toMatchObject({ role: null });
  });
});

describe.each(storeFactories)("requireRole guard ($name store)", ({ make }) => {
  it("resolves roles and throws typed errors for missing tournaments / roles", () => {
    const store: Store = resolveStore(make());
    const organizer = registerUser(store, "Org");
    const player = registerUser(store, "Player");

    const tournamentId = "t-guard-1";
    store.transaction(() => {
      store.insertTournament({
        tournamentId,
        settings: { findingVisibilityMode: "players" },
        createdBy: organizer.userId,
        createdAt: new Date().toISOString(),
      });
      store.upsertMembership({ tournamentId, userId: organizer.userId, role: "organizer" });
      store.upsertMembership({ tournamentId, userId: player.userId, role: "player" });
    });

    expect(getMembershipRole(store, tournamentId, organizer.userId)).toBe("organizer");
    expect(getMembershipRole(store, tournamentId, player.userId)).toBe("player");
    expect(getMembershipRole(store, tournamentId, "ghost")).toBeUndefined();

    expect(requireRole(store, tournamentId, organizer, ["organizer"])).toBe("organizer");
    expect(() => requireRole(store, tournamentId, player, ["organizer"])).toThrow(ForbiddenError);
    expect(() => requireRole(store, "missing", organizer, ["organizer"])).toThrow(/tournament-not-found/);
  });

  it("resolves users from bearer tokens and rejects unknown tokens", () => {
    const store: Store = resolveStore(make());
    const registration = registerUser(store, "Someone");
    expect(store.findUserIdByTokenHash("nope")).toBeUndefined();
    expect(store.getUser(registration.userId)?.displayName).toBe("Someone");
  });
});
