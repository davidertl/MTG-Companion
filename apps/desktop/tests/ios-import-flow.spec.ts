import { describe, expect, it } from "vitest";

import { getIosOfflineImportGuidance, getIosOfflineImportMethods } from "../src/routes/setup/index";

describe("iOS offline import flow", () => {
  it("supports drag and drop and folder import for exported .log files", () => {
    expect(getIosOfflineImportMethods()).toEqual([
      expect.objectContaining({
        id: "drag-and-drop",
        accepts: [".log"],
        platformTag: "ios",
      }),
      expect.objectContaining({
        id: "folder-import",
        accepts: [".log"],
        platformTag: "ios",
      }),
    ]);
  });

  it("guides Windows users toward Apple Devices without requiring iTunes", () => {
    const guidance = getIosOfflineImportGuidance("windows");

    expect(guidance.noItunesRequired).toBe(true);
    expect(guidance.primaryGuidance).toContain("Apple Devices");
    expect(guidance.steps[0]).toContain("Apple Devices");
    expect(guidance.fallbackNote).toContain("Drittanbieter-Tools");
    expect(guidance.futureIosAppNote).toContain("Viewer-");
  });

  it("guides macOS users toward Finder and documents non-goals", () => {
    const guidance = getIosOfflineImportGuidance("macos");

    expect(guidance.primaryGuidance).toContain("Finder");
    expect(guidance.steps[0]).toContain("Finder");
    expect(guidance.nonGoals).toContain("Kein Live-Tracking auf iPad/iPhone");
    expect(guidance.nonGoals.some((goal) => goal.includes("Memory Inspection"))).toBe(true);
  });
});
