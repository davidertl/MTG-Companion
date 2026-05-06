import { describe, expect, it } from "vitest";

import { buildPrivacyRoute, canSendNetworkRequest, createPrivacySettings } from "../src/index";

describe("privacy center", () => {
  it("keeps telemetry disabled by default while updates remain allowed", () => {
    const settings = createPrivacySettings();
    const state = buildPrivacyRoute(settings);

    expect(state.modeLabel).toBe("Offline-only mode");
    expect(canSendNetworkRequest(settings, "updates")).toBe(true);
    expect(canSendNetworkRequest(settings, "telemetry")).toBe(false);
  });

  it("clones allowed purposes so route state mutation does not leak back into settings", () => {
    const settings = createPrivacySettings({
      telemetryEnabled: true,
      syncEnabled: true,
      allowedPurposes: ["updates", "telemetry"],
    });

    const state = buildPrivacyRoute(settings);
    state.allowedPurposes.push("sync");

    expect(settings.allowedPurposes).toEqual(["updates", "telemetry"]);
  });
});
