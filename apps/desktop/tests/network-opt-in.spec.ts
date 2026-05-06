import { describe, expect, it } from "vitest";

import { canSendNetworkRequest, createPrivacySettings } from "../src/lib/network/privacy";

describe("network opt-in gating", () => {
  it("blocks sync until enabled but allows explicit archidekt imports independently", () => {
    const settings = createPrivacySettings({
      telemetryEnabled: false,
      syncEnabled: false,
      allowedPurposes: ["updates", "sync", "archidekt"],
    });

    expect(canSendNetworkRequest(settings, "updates")).toBe(true);
    expect(canSendNetworkRequest(settings, "sync")).toBe(false);
    expect(canSendNetworkRequest(settings, "archidekt")).toBe(true);
  });
});
