import { describe, expect, it } from "vitest";

import { buildDiagnosticsRouteState } from "../src/routes/diagnostics/index";

describe("diagnostics route state", () => {
  it("surfaces warnings and unknown-event counts", () => {
    const state = buildDiagnosticsRouteState(
      [
        {
          sessionId: "session-1",
          sourcePath: "/tmp/Player.log",
          diagnosticKind: "parse-warning",
          message: "invalid line",
        },
      ],
      ["FuturePatchEvent"],
    );

    expect(state.empty).toBe(false);
    expect(state.warningCount).toBe(1);
    expect(state.unknownEventCount).toBe(1);
  });

  it("stays empty without diagnostics", () => {
    const state = buildDiagnosticsRouteState([], []);
    expect(state.empty).toBe(true);
  });
});
