import { describe, expect, it } from "vitest";

import { buildImportCenterState } from "../src/routes/imports/index";

describe("import center state", () => {
  it("shows desktop and iOS offline import capabilities even without history", () => {
    const state = buildImportCenterState();

    expect(state.empty).toBe(true);
    expect(state.availableMethods.map((method) => method.id)).toEqual(
      expect.arrayContaining(["drag-and-drop", "folder-import"]),
    );
    expect(state.iosGuidance.platformTag).toBe("ios");
  });

  it("surfaces the last iOS import summary with deduplication details", () => {
    const state = buildImportCenterState({
      lastImportSummary: {
        platformTag: "ios",
        sourceKind: "folder-import",
        discoveredLogFiles: 3,
        importedSessions: 2,
        duplicateSessions: 1,
        insertedRawChunks: 10,
        insertedEvents: 7,
        importedPaths: ["Exports/Player-1.log", "Exports/Player-2.log"],
        parseWarnings: [],
      },
    });

    expect(state.empty).toBe(false);
    expect(state.lastImportSummary?.platformTag).toBe("ios");
    expect(state.lastImportSummary?.duplicateSessions).toBe(1);
    expect(state.summary).toContain("2 neue Session");
  });
});
