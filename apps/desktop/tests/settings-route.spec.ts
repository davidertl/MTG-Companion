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

  it("hard-gates the Sync now trigger and reports a disabled status when sync is off", () => {
    const settings = createPrivacySettings({ syncEnabled: false });
    const state = buildSettingsState(settings);

    expect(state.sync.canSyncNow).toBe(false);
    expect(state.sync.triggerLabel).toBe("Sync now");
    expect(state.sync.status.state).toBe("disabled");
    expect(state.actions).toEqual(expect.arrayContaining(["Sync now"]));
  });

  it("surfaces the last sync outcome when sync is enabled", () => {
    const settings = createPrivacySettings({
      syncEnabled: true,
      allowedPurposes: ["updates", "sync"],
    });

    const idle = buildSettingsState(settings);
    expect(idle.sync.canSyncNow).toBe(true);
    expect(idle.sync.status.state).toBe("idle");

    const synced = buildSettingsState(settings, {
      syncOutcome: {
        attempted: true,
        eventsSynced: 5,
        pendingRemaining: 0,
        lastError: null,
      },
    });
    expect(synced.sync.status.state).toBe("ok");
    expect(synced.sync.status.message).toContain("5");

    const failed = buildSettingsState(settings, {
      syncOutcome: {
        attempted: true,
        eventsSynced: 0,
        pendingRemaining: 2,
        lastError: "transport error: connection refused",
      },
    });
    expect(failed.sync.status.state).toBe("error");
    expect(failed.sync.status.message).toContain("connection refused");
  });
});
