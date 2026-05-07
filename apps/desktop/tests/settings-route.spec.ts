import { describe, expect, it } from "vitest";

import { buildSettingsState, createPrivacySettings } from "../src/index";

describe("settings route state", () => {
  it("surfaces consent toggles and local data actions", () => {
    const settings = createPrivacySettings({
      telemetryEnabled: true,
      syncEnabled: false,
      allowedPurposes: ["updates", "telemetry", "archidekt"],
    });

    const state = buildSettingsState(settings);

    expect(state.telemetryEnabled).toBe(true);
    expect(state.syncEnabled).toBe(false);
    expect(state.archidektEnabled).toBe(true);
    expect(state.settingsFileName).toBe("mancutg-arenac-settings.json");
    expect(state.actions).toEqual(
      expect.arrayContaining(["Set consent", "Reset settings", "Wipe local data"]),
    );
  });
});
