import { describe, expect, it } from "vitest";

import {
  buildArenaAppShellState,
  renderArenaAppShell,
} from "../src/index";

describe("MancuTG-ArenaC application shell", () => {
  it("renders a shell that exposes the existing ArenaC workflows", () => {
    const state = buildArenaAppShellState({
      hasDetailedLogs: true,
      detailedLogsAcknowledged: true,
      logPath: "/tmp/Player.log",
      watcherRunning: true,
      privacy: {
        telemetryEnabled: false,
        syncEnabled: false,
        allowedPurposes: ["updates", "archidekt"],
      },
      importSummary: {
        platformTag: "ios",
        sourceKind: "folder-import",
        discoveredLogFiles: 3,
        importedSessions: 2,
        duplicateSessions: 1,
        insertedRawChunks: 10,
        insertedEvents: 7,
        importedPaths: ["Exports/Player-1.log"],
        parseWarnings: [],
      },
      matches: [
        { matchId: "m1", deck: "Azorius Control", result: "win", queue: "ranked" },
      ],
      collection: {
        cardsOwned: 620,
        capturedAt: "2026-05-07T02:00:00Z",
      },
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
    });

    const html = renderArenaAppShell(state);

    expect(html).toContain("MancuTG-ArenaC");
    expect(html).toContain("Stop live watcher");
    expect(html).toContain("Import iOS log folder");
    expect(html).toContain("Match History");
    expect(html).toContain("Collection");
    expect(html).toContain("Inventory");
    expect(html).toContain("Import Archidekt deck (read-only)");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Privacy");
    expect(html).toContain("Wipe local data");
    expect(html).toContain("2 neue Sessions, 1 Duplikat");
  });
});
