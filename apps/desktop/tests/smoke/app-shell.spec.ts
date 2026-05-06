import { describe, expect, it } from "vitest";

import {
  buildCollectionRouteState,
  buildDecksRouteState,
  buildDraftRouteState,
  buildHistoryRouteState,
  buildImportCenterState,
  buildPrivacyRouteState,
  buildSettingsState,
  getSetupBanner,
} from "../../src/index";
import { createPrivacySettings } from "../../src/lib/network/privacy";

describe("desktop shell exports", () => {
  it("builds the initial offline-first route states", () => {
    const privacy = createPrivacySettings();

    expect(getSetupBanner({ hasDetailedLogs: true, logPath: "/tmp/Player.log" })).toContain(
      "bereit",
    );
    expect(buildHistoryRouteState([]).empty).toBe(true);
    expect(buildCollectionRouteState(undefined).empty).toBe(true);
    expect(buildDraftRouteState([]).empty).toBe(true);
    expect(buildSettingsState(privacy).offlineCapable).toBe(true);
    expect(buildDecksRouteState([]).empty).toBe(true);
    expect(buildImportCenterState().availableMethods).toHaveLength(2);
    expect(buildPrivacyRouteState(privacy).modeLabel).toBe("Offline-only mode");
  });
});
