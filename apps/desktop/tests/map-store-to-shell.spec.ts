import { describe, expect, it } from "vitest";

import { mapToArenaAppShellInput } from "../src/lib/api/mapStoreToShell";

const emptyStore = {
  sessions: [],
  matchHistory: [],
  collectionSnapshot: null,
  inventorySnapshot: null,
  draftPicks: [],
  unknownEvents: [],
  diagnostics: [],
  checkpoints: [],
};

describe("mapToArenaAppShellInput", () => {
  it("uses detailedLogsAcknowledged for setup checklist, not mere log path presence", () => {
    const input = mapToArenaAppShellInput({
      store: emptyStore,
      settings: {
        privacy: {
          telemetryEnabled: false,
          syncEnabled: false,
          allowedPurposes: ["updates"],
        },
        detailedLogsAcknowledged: false,
      },
      service: {
        logPath: "C:/Games/Player.log",
        defaultPlayerLogPath: "C:/Games/Player.log",
      },
      watcherRunning: false,
      lastImportSummary: null,
    });
    expect(input.hasDetailedLogs).toBe(false);
    expect(input.logPath).toBe("C:/Games/Player.log");
    expect(input.detailedLogsAcknowledged).toBe(false);
  });

  it("marks detailed logs complete when acknowledged in settings", () => {
    const input = mapToArenaAppShellInput({
      store: emptyStore,
      settings: {
        privacy: {
          telemetryEnabled: false,
          syncEnabled: false,
          allowedPurposes: ["updates"],
        },
        detailedLogsAcknowledged: true,
      },
      service: { logPath: null, defaultPlayerLogPath: null },
      watcherRunning: false,
      lastImportSummary: null,
    });
    expect(input.hasDetailedLogs).toBe(true);
    expect(input.detailedLogsAcknowledged).toBe(true);
  });
});
