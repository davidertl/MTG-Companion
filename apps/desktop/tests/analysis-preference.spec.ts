import { describe, expect, it } from "vitest";

import {
  ANALYSIS_ENABLED_KEY,
  readAnalysisEnabled,
  writeAnalysisEnabled,
} from "../src/lib/settings/analysisPreference";
import { buildSettingsState } from "../src/routes/settings/index";
import { createPrivacySettings } from "../src/index";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    _map: map,
  };
}

describe("analysis preference persistence", () => {
  it("defaults to enabled when unset", () => {
    const storage = memoryStorage();
    expect(readAnalysisEnabled(storage)).toBe(true);
  });

  it("round-trips a written value", () => {
    const storage = memoryStorage();
    writeAnalysisEnabled(false, storage);
    expect(storage._map.get(ANALYSIS_ENABLED_KEY)).toBe("false");
    expect(readAnalysisEnabled(storage)).toBe(false);

    writeAnalysisEnabled(true, storage);
    expect(readAnalysisEnabled(storage)).toBe(true);
  });
});

describe("settings state with analysis + card db", () => {
  it("surfaces the analysis toggle and card DB status", () => {
    const settings = createPrivacySettings({ allowedPurposes: ["updates"] });
    const state = buildSettingsState(settings, {
      analysisEnabled: false,
      cardDb: { cardDbExists: true, cardCount: 100, withArenaIdCount: 40 },
    });
    expect(state.analysisEnabled).toBe(false);
    expect(state.cardDb.imported).toBe(true);
    expect(state.cardDb.label).toBe("100 cards (40 with Arena id)");
  });

  it("defaults analysis on and reports card DB not imported without extras", () => {
    const settings = createPrivacySettings();
    const state = buildSettingsState(settings);
    expect(state.analysisEnabled).toBe(true);
    expect(state.cardDb.imported).toBe(false);
    expect(state.cardDb.label).toBe("Not imported");
  });
});
