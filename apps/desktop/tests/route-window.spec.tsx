import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderArenaRouteContent } from "../src/app/ArenaRouteWindow";
import { ARENA_ROUTES } from "../src/app/routes";
import { buildArenaAppShellState } from "../src/app/buildArenaAppShellState";

const fullShellInput = {
  hasDetailedLogs: true,
  detailedLogsAcknowledged: true,
  logPath: "/tmp/Player.log",
  watcherRunning: true,
  privacy: {
    telemetryEnabled: false,
    syncEnabled: false,
    allowedPurposes: ["updates", "archidekt"] as Array<"updates" | "sync" | "telemetry" | "archidekt">,
  },
  importSummary: {
    platformTag: "ios" as const,
    sourceKind: "folder-import" as const,
    discoveredLogFiles: 3,
    importedSessions: 2,
    duplicateSessions: 1,
    insertedRawChunks: 10,
    insertedEvents: 7,
    importedPaths: ["Exports/Player-1.log"],
    parseWarnings: [],
  },
  matches: [
    { matchId: "m1", deck: "Azorius Control", result: "win" as const, queue: "ranked" },
  ],
  collection: { cardsOwned: 620, capturedAt: "2026-05-07T02:00:00Z" },
  inventory: {
    gold: 1200,
    gems: 400,
    wildcards: 12,
    vault: 34,
    capturedAt: "2026-05-07T02:01:00Z",
  },
  draftPicks: [
    {
      setCode: "OTJ",
      packNumber: 1,
      pickNumber: 2,
      choice: "Caustic Bronco",
    },
  ],
  diagnostics: [
    {
      sessionId: "session-1",
      sourcePath: "/tmp/Player.log",
      diagnosticKind: "parse-warning",
      message: "invalid line",
    },
  ],
  unknownEvents: ["FuturePatchEvent"],
};

function shell() {
  return buildArenaAppShellState(fullShellInput);
}

describe("ArenaRouteWindow per-route SSR", () => {
  it("registers one Overwolf window per side-nav entry", () => {
    const ids = ARENA_ROUTES.map((route) => route.id);
    expect(ids).toEqual([
      "match-history",
      "imports",
      "collection",
      "inventory",
      "draft",
      "decks",
      "diagnostics",
      "privacy",
      "settings",
      "setup",
    ]);
  });

  it("renders the imports panel with iOS guidance and last-import summary", () => {
    const html = renderToStaticMarkup(<>{renderArenaRouteContent("imports", shell())}</>);
    expect(html).toContain("Import Center");
    expect(html).toContain("2 neue Sessions, 1 Duplikat");
  });

  it("renders the collection panel with the captured card count", () => {
    const html = renderToStaticMarkup(<>{renderArenaRouteContent("collection", shell())}</>);
    expect(html).toContain("Cards owned");
    expect(html).toContain("620");
  });

  it("renders the diagnostics panel with the warning list and unknown events", () => {
    const html = renderToStaticMarkup(<>{renderArenaRouteContent("diagnostics", shell())}</>);
    expect(html).toContain("Diagnostics");
    expect(html).toContain("parse-warning");
    expect(html).toContain("invalid line");
    expect(html).toContain("FuturePatchEvent");
  });

  it("renders the settings panel with detailed-logs status", () => {
    const html = renderToStaticMarkup(<>{renderArenaRouteContent("settings", shell())}</>);
    expect(html).toContain("Acknowledged");
    expect(html).toContain("Wipe local data");
  });
});
