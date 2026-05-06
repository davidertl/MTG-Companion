import { describe, expect, it } from "vitest";

import { getSetupBanner, getSetupChecklist } from "../src/routes/setup/index";

describe("setup route", () => {
  it("shows actionable help until detailed logs and log path are available", () => {
    expect(getSetupBanner({ hasDetailedLogs: false })).toContain("Detailed Logs");
    expect(
      getSetupChecklist({
        hasDetailedLogs: true,
        logPath: "/Users/example/Player.log",
      }),
    ).toEqual([
      expect.objectContaining({ id: "detailed-logs", complete: true }),
      expect.objectContaining({ id: "log-path", complete: true }),
    ]);
  });
});
