import { describe, expect, it } from "vitest";

import { createPrivacySettings } from "../../../apps/desktop/src/lib/network/privacy";
import { recordTelemetryEvent } from "../src/telemetry/optIn";

describe("telemetry opt in", () => {
  it("ignores telemetry while opt-in is disabled", () => {
    const result = recordTelemetryEvent(
      createPrivacySettings({
        telemetryEnabled: false,
        syncEnabled: false,
        allowedPurposes: ["updates"],
      }),
      {
        name: "parser.booted",
        properties: {
          environment: "test",
        },
      },
    );

    expect(result.accepted).toBe(false);
  });

  it("accepts telemetry when telemetry is allowed", () => {
    const result = recordTelemetryEvent(
      createPrivacySettings({
        telemetryEnabled: true,
        syncEnabled: true,
        allowedPurposes: ["updates", "telemetry"],
      }),
      {
        name: "parser.booted",
        properties: {
          environment: "test",
        },
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.event?.name).toBe("parser.booted");
  });
});
