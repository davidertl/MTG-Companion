import { describe, expect, it } from "vitest";

import type { AnalysisFinding } from "../../../packages/shared-schema/src/index";
import {
  REFEREE_ONLY_NOTICE,
  buildLocalFindingsView,
} from "../src/state/findingSuppression";

function finding(id: string): AnalysisFinding {
  return {
    findingId: id,
    gameKey: "game-1",
    turnNumber: 2,
    phase: "main-1",
    kind: "rule-check",
    code: "extra-land-drop",
    severity: "possible-violation",
    confidence: 0.9,
    ruleRefs: ["CR 305.2"],
    description: "possible extra land drop",
    audience: "referee-only",
    engineVersion: "test-1",
  };
}

describe("buildLocalFindingsView — client-side referee-only suppression", () => {
  const present = [finding("f1"), finding("f2"), finding("f3")];

  it("shows ZERO findings and a routing notice in referee-only mode, even with data present", () => {
    const view = buildLocalFindingsView(present, "referee-only");
    expect(view.refereeOnly).toBe(true);
    expect(view.findings).toHaveLength(0);
    expect(view.notice).toBe(REFEREE_ONLY_NOTICE);
  });

  it("passes findings through unchanged in players mode (no notice)", () => {
    const view = buildLocalFindingsView(present, "players");
    expect(view.refereeOnly).toBe(false);
    expect(view.notice).toBeNull();
    expect(view.findings.map((f) => f.findingId)).toEqual(["f1", "f2", "f3"]);
  });

  it("treats an unbound/undefined mode as players (findings visible)", () => {
    const view = buildLocalFindingsView(present, undefined);
    expect(view.refereeOnly).toBe(false);
    expect(view.notice).toBeNull();
    expect(view.findings).toHaveLength(3);
  });

  it("does not mutate the input array", () => {
    const input = [finding("f1")];
    buildLocalFindingsView(input, "referee-only");
    expect(input).toHaveLength(1);
  });
});
