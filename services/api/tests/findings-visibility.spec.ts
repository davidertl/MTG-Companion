import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  createSqliteStore,
  isFindingVisible,
  startApiServer,
  type BackendStoreLike,
  type StartedApiServer,
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

type Mode = "players" | "referee-only";
type Audience = "players" | "referee-only" | "all";
type Role = "organizer" | "referee" | "player" | "spectator";

const MODES: Mode[] = ["players", "referee-only"];
const AUDIENCES: Audience[] = ["players", "referee-only", "all"];
const ROLES: Role[] = ["organizer", "referee", "player", "spectator"];

/** Independent reference table for the {mode × audience × role} matrix. */
function expectedVisible(mode: Mode, audience: Audience, role: Role): boolean {
  if (role === "organizer" || role === "referee") {
    return true;
  }
  if (mode === "referee-only") {
    return false;
  }
  if (audience === "referee-only") {
    return false;
  }
  if (audience === "all") {
    return true;
  }
  // audience === "players"
  return role === "player";
}

// --- Exhaustive pure-function matrix (24 rows) -------------------------------

describe("isFindingVisible — exhaustive {mode × audience × role} matrix", () => {
  const cases: Array<{ mode: Mode; audience: Audience; role: Role; visible: boolean }> = [];
  for (const mode of MODES) {
    for (const audience of AUDIENCES) {
      for (const role of ROLES) {
        cases.push({ mode, audience, role, visible: expectedVisible(mode, audience, role) });
      }
    }
  }

  it.each(cases)(
    "mode=$mode audience=$audience role=$role -> visible=$visible",
    ({ mode, audience, role, visible }) => {
      expect(isFindingVisible({ mode, audience, role })).toBe(visible);
    },
  );

  it("covers all 24 combinations", () => {
    expect(cases).toHaveLength(24);
  });

  it("is default-deny for the referee-only audience outside the referee tier", () => {
    for (const mode of MODES) {
      expect(isFindingVisible({ mode, audience: "referee-only", role: "player" })).toBe(false);
      expect(isFindingVisible({ mode, audience: "referee-only", role: "spectator" })).toBe(false);
    }
  });
});

// --- HTTP integration -------------------------------------------------------

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

async function createTournament(baseUrl: string, token: string, mode: Mode) {
  const response = await fetch(`${baseUrl}/tournaments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: "Test Cup", settings: { findingVisibilityMode: mode } }),
  });
  expect(response.status).toBe(201);
  const { tournament } = (await response.json()) as {
    tournament: { tournamentId: string };
  };
  return tournament.tournamentId;
}

async function addMember(
  baseUrl: string,
  organizerToken: string,
  tournamentId: string,
  userId: string,
  role: Role,
) {
  const response = await fetch(`${baseUrl}/tournaments/${tournamentId}/members`, {
    method: "POST",
    headers: authHeaders(organizerToken),
    body: JSON.stringify({ userId, role }),
  });
  expect(response.status).toBe(201);
}

/** Posts a finding into the tournament via the ordinary /events pipeline. */
async function postFinding(
  baseUrl: string,
  tournamentId: string,
  findingId: string,
  audience: Audience,
  gameKey = "game-1",
) {
  const sourceSessionId = "backend-analysis-1";
  const batch = {
    idempotencyKey: `finding-${findingId}-${Math.random()}`,
    sessions: [
      {
        sourceSessionId,
        sourceApp: "mancutg-backend",
        sourceKind: "backend-process",
        platform: "service",
        gameMode: "service",
        startedAt: "2026-07-06T10:00:00Z",
      },
    ],
    events: [
      {
        eventId: findingId,
        sourceApp: "mancutg-backend",
        sourceSessionId,
        eventType: "analysis.finding.raised",
        occurredAt: "2026-07-06T10:00:01Z",
        provenance: [{ sourceKind: "backend-process", sourceSessionId }],
        payload: {
          tournamentId,
          findingId,
          gameKey,
          turnNumber: 3,
          phase: "combat",
          kind: "rule-check",
          code: "extra-land-drop",
          severity: "possible-violation",
          confidence: 0.8,
          ruleRefs: ["CR 305.2"],
          description: "possible extra land drop",
          audience,
          engineVersion: "test-1",
        },
      },
    ],
  };

  const response = await fetch(`${baseUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch),
  });
  expect(response.status).toBe(200);
}

async function getFindings(baseUrl: string, tournamentId: string, token: string) {
  const response = await fetch(`${baseUrl}/tournaments/${tournamentId}/findings`, {
    headers: authHeaders(token),
  });
  return response;
}

describe.each(storeFactories)("findings visibility API ($name store)", ({ make }) => {
  async function bootstrap(mode: Mode) {
    const server = await startApiServer(0, { eventStore: make(), allowRegistration: true });
    servers.push(server);
    const base = server.baseUrl;

    const organizer = await registerViaHttp(base, "Olivia Organizer");
    const referee = await registerViaHttp(base, "Rita Referee");
    const player = await registerViaHttp(base, "Peter Player");
    const spectator = await registerViaHttp(base, "Sam Spectator");

    const tournamentId = await createTournament(base, organizer.token, mode);
    await addMember(base, organizer.token, tournamentId, referee.userId, "referee");
    await addMember(base, organizer.token, tournamentId, player.userId, "player");
    await addMember(base, organizer.token, tournamentId, spectator.userId, "spectator");

    return { base, tournamentId, organizer, referee, player, spectator };
  }

  it("referee sees a referee-only finding", async () => {
    const { base, tournamentId, referee } = await bootstrap("referee-only");
    await postFinding(base, tournamentId, "f-ref-only", "referee-only");

    const response = await getFindings(base, tournamentId, referee.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      findings: Array<{ finding: { findingId: string } }>;
    };
    expect(body.findings.map((entry) => entry.finding.findingId)).toContain("f-ref-only");
  });

  it("player gets 200 with a referee-only finding ABSENT (never 403 for that item)", async () => {
    const { base, tournamentId, player } = await bootstrap("players");
    await postFinding(base, tournamentId, "f-hidden", "referee-only");
    await postFinding(base, tournamentId, "f-visible", "players");

    const response = await getFindings(base, tournamentId, player.token);
    // Presence must not leak: not a 403, a plain 200 with the hidden item absent.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      findings: Array<{ finding: { findingId: string } }>;
    };
    const ids = body.findings.map((entry) => entry.finding.findingId);
    expect(ids).toContain("f-visible");
    expect(ids).not.toContain("f-hidden");
  });

  it("spectator sees nothing in referee-only mode", async () => {
    const { base, tournamentId, spectator } = await bootstrap("referee-only");
    await postFinding(base, tournamentId, "f-a", "all");
    await postFinding(base, tournamentId, "f-b", "players");
    await postFinding(base, tournamentId, "f-c", "referee-only");

    const response = await getFindings(base, tournamentId, spectator.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { findings: unknown[] };
    expect(body.findings).toHaveLength(0);
  });

  it("organizer counts as referee for visibility (sees referee-only findings)", async () => {
    const { base, tournamentId, organizer } = await bootstrap("referee-only");
    await postFinding(base, tournamentId, "f-org", "referee-only");

    const response = await getFindings(base, tournamentId, organizer.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      findings: Array<{ finding: { findingId: string } }>;
    };
    expect(body.findings.map((entry) => entry.finding.findingId)).toContain("f-org");
  });

  it("review transition emits an analysis.finding.reviewed event and is idempotent", async () => {
    const { base, tournamentId, referee } = await bootstrap("referee-only");
    await postFinding(base, tournamentId, "f-review", "referee-only");

    const first = await fetch(
      `${base}/tournaments/${tournamentId}/findings/f-review/review`,
      {
        method: "POST",
        headers: authHeaders(referee.token),
        body: JSON.stringify({ resolution: "confirmed", note: "seen by judge" }),
      },
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      review: { findingId: "f-review", resolution: "confirmed", reviewedBy: referee.userId },
      duplicate: false,
    });

    // The reviewed finding now carries its review state in the referee read.
    const afterReview = await getFindings(base, tournamentId, referee.token);
    const afterBody = (await afterReview.json()) as {
      findings: Array<{ finding: { findingId: string }; review: { resolution: string } | null }>;
    };
    const reviewed = afterBody.findings.find((entry) => entry.finding.findingId === "f-review");
    expect(reviewed?.review?.resolution).toBe("confirmed");

    // A reviewed event exists on the append-only stream.
    const pull = await fetch(`${base}/events?tournamentId=${tournamentId}&limit=500`);
    const pullBody = (await pull.json()) as {
      events: Array<{ eventType: string }>;
    };
    const reviewedEvents = pullBody.events.filter(
      (event) => event.eventType === "analysis.finding.reviewed",
    );
    expect(reviewedEvents).toHaveLength(1);

    // Idempotent: re-posting the same resolution adds no new event.
    const second = await fetch(
      `${base}/tournaments/${tournamentId}/findings/f-review/review`,
      {
        method: "POST",
        headers: authHeaders(referee.token),
        body: JSON.stringify({ resolution: "confirmed", note: "seen by judge" }),
      },
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });

    const pullAgain = await fetch(`${base}/events?tournamentId=${tournamentId}&limit=500`);
    const pullAgainBody = (await pullAgain.json()) as {
      events: Array<{ eventType: string }>;
    };
    expect(
      pullAgainBody.events.filter((event) => event.eventType === "analysis.finding.reviewed"),
    ).toHaveLength(1);
  });

  it("forbids a player from reviewing a finding (403)", async () => {
    const { base, tournamentId, player } = await bootstrap("players");
    await postFinding(base, tournamentId, "f-p", "players");

    const attempt = await fetch(
      `${base}/tournaments/${tournamentId}/findings/f-p/review`,
      {
        method: "POST",
        headers: authHeaders(player.token),
        body: JSON.stringify({ resolution: "confirmed" }),
      },
    );
    expect(attempt.status).toBe(403);
    await expect(attempt.json()).resolves.toMatchObject({ error: "insufficient-role" });
  });

  it("rejects unauthenticated findings reads with 401", async () => {
    const { base, tournamentId } = await bootstrap("players");

    const noAuth = await fetch(`${base}/tournaments/${tournamentId}/findings`);
    expect(noAuth.status).toBe(401);
    await expect(noAuth.json()).resolves.toMatchObject({ error: "unauthorized" });

    const noAuthReview = await fetch(
      `${base}/tournaments/${tournamentId}/findings/anything/review`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(noAuthReview.status).toBe(401);
  });
});
