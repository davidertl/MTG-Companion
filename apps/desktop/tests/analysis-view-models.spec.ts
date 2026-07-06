import { describe, expect, it } from "vitest";

import {
  buildCardDbStatusView,
  buildFindingsViewModel,
  buildMatchAnalysisState,
  buildTimelineViewModel,
  CARD_DB_IMPORT_GUIDANCE,
} from "../src/routes/history/index";
import type {
  RustFinding,
  RustGameTimeline,
} from "../src/lib/tauri/commands";

function timeline(): RustGameTimeline {
  return {
    turns: [
      {
        turnNumber: 1,
        activePlayer: "playerA",
        phase: "main1",
        step: "precombat-main",
        zones: {
          playerA: {
            battlefield: [
              { cardRef: { name: "Forest" }, tapped: false },
              { cardRef: { arenaId: 12345 }, tapped: false },
            ],
            graveyard: [],
            exile: [],
            handCount: 6,
            libraryCount: 33,
          },
          playerB: {
            battlefield: [],
            graveyard: [],
            exile: [],
            handCount: 7,
            libraryCount: 33,
          },
        },
        lifeTotals: { playerA: 20, playerB: 20 },
        actions: [{ source: "raw", eventType: "LAND_PLAYED", sequence: 1, payload: {}, note: "Played Forest" }],
      },
      {
        turnNumber: 2,
        activePlayer: "playerB",
        phase: "combat",
        step: "declare-attackers",
        zones: {},
        lifeTotals: { playerA: 18, playerB: 20 },
        actions: [],
      },
      {
        turnNumber: 3,
        activePlayer: "playerA",
        phase: "main1",
        step: "precombat-main",
        zones: {},
        lifeTotals: { playerA: 18, playerB: 20 },
        actions: [],
      },
    ],
    completeness: { kind: "complete" },
    notes: ["synthetic fixture"],
  };
}

function finding(overrides: Partial<RustFinding>): RustFinding {
  return {
    findingId: "f-default",
    gameKey: "match-1",
    turnNumber: 1,
    phase: "main1",
    kind: "rule-check",
    code: "extra-land-drop",
    severity: "possible-violation",
    confidence: 0.62,
    ruleRefs: ["CR 305.2"],
    description: "possible extra land drop this turn",
    audience: "players",
    engineVersion: "test",
    ...overrides,
  };
}

describe("buildTimelineViewModel", () => {
  it("maps per-turn active player, phase, zones and life", () => {
    const vm = buildTimelineViewModel(timeline());
    expect(vm.empty).toBe(false);
    expect(vm.partial).toBe(false);
    expect(vm.turns).toHaveLength(3);

    const t1 = vm.turns[0];
    expect(t1.activePlayer).toBe("playerA");
    expect(t1.phase).toBe("main1");
    const a = t1.players.find((p) => p.player === "playerA")!;
    expect(a.life).toBe(20);
    expect(a.handCount).toBe(6);
    expect(a.battlefieldCount).toBe(2);
    // Named card kept verbatim; unnamed arena id gets a stable label.
    expect(a.battlefield).toEqual(["Forest", "Arena #12345"]);
    expect(t1.actions[0].label).toBe("Played Forest");
  });

  it("places rule-check findings inline on their matching turn", () => {
    const findings = [
      finding({ findingId: "f1", code: "extra-land-drop", turnNumber: 1 }),
      finding({ findingId: "f3", code: "illegal-attack", turnNumber: 3 }),
    ];
    const vm = buildTimelineViewModel(timeline(), findings);

    expect(vm.turns[0].findings.map((f) => f.findingId)).toEqual(["f1"]);
    expect(vm.turns[1].findings).toEqual([]);
    expect(vm.turns[2].findings.map((f) => f.findingId)).toEqual(["f3"]);
    expect(vm.unplacedFindings).toEqual([]);
  });

  it("keeps findings whose turn matches no reconstructed turn", () => {
    const vm = buildTimelineViewModel(timeline(), [
      finding({ findingId: "orphan", turnNumber: 99 }),
    ]);
    expect(vm.turns.every((t) => t.findings.length === 0)).toBe(true);
    expect(vm.unplacedFindings.map((f) => f.findingId)).toEqual(["orphan"]);
  });

  it("surfaces partial completeness with its reason", () => {
    const t = timeline();
    t.completeness = { kind: "partial", reason: "truncated log" };
    const vm = buildTimelineViewModel(t);
    expect(vm.partial).toBe(true);
    expect(vm.partialReason).toBe("truncated log");
  });

  it("excludes suggestions from inline markers", () => {
    const vm = buildTimelineViewModel(timeline(), [
      finding({ findingId: "s1", kind: "suggestion", code: "lethal-available", turnNumber: 1 }),
    ]);
    expect(vm.turns[0].findings).toEqual([]);
    expect(vm.unplacedFindings).toEqual([]);
  });
});

describe("buildFindingsViewModel", () => {
  it("splits rule-checks from suggestions and formats verbatim, non-overclaiming labels", () => {
    const vm = buildFindingsViewModel([
      finding({ findingId: "r1", kind: "rule-check", code: "extra-land-drop" }),
      finding({ findingId: "s1", kind: "suggestion", code: "lethal-available", severity: "info", confidence: 0.4 }),
    ]);
    expect(vm.ruleFindings.map((f) => f.findingId)).toEqual(["r1"]);
    expect(vm.suggestions.map((f) => f.findingId)).toEqual(["s1"]);

    const rule = vm.ruleFindings[0];
    expect(rule.severityLabel).toBe("Possible rule-break");
    expect(rule.severityLabel).not.toContain("cheat");
    // Confidence is shown verbatim (raw value + percent).
    expect(rule.confidenceLabel).toBe("Confidence 0.62 (62%)");
    expect(rule.confidencePercent).toBe(62);
    expect(rule.ruleRefsLabel).toBe("CR 305.2");
  });

  it("orders deterministically by turn, then code, then id", () => {
    const vm = buildFindingsViewModel([
      finding({ findingId: "b", code: "zzz", turnNumber: 2 }),
      finding({ findingId: "a", code: "aaa", turnNumber: 2 }),
      finding({ findingId: "c", code: "aaa", turnNumber: 1 }),
    ]);
    expect(vm.all.map((f) => f.findingId)).toEqual(["c", "a", "b"]);
  });
});

describe("buildCardDbStatusView", () => {
  it("reports import guidance when no DB is present", () => {
    const view = buildCardDbStatusView(null);
    expect(view.imported).toBe(false);
    expect(view.label).toBe("Not imported");
    expect(view.guidance).toBe(CARD_DB_IMPORT_GUIDANCE);
    expect(view.guidance).toContain("import-card-db");

    const notImported = buildCardDbStatusView({
      cardDbExists: false,
      cardCount: 0,
      withArenaIdCount: 0,
    });
    expect(notImported.imported).toBe(false);
  });

  it("summarizes counts when the DB is imported", () => {
    const view = buildCardDbStatusView({
      cardDbExists: true,
      cardCount: 12345,
      withArenaIdCount: 3210,
    });
    expect(view.imported).toBe(true);
    expect(view.cardCount).toBe(12345);
    expect(view.withArenaIdCount).toBe(3210);
    expect(view.label).toBe("12345 cards (3210 with Arena id)");
    expect(view.guidance).toBeNull();
  });
});

describe("buildMatchAnalysisState", () => {
  it("composes timeline, findings, and card-db views", () => {
    const state = buildMatchAnalysisState({
      matchId: "match-1",
      timeline: timeline(),
      findings: [finding({ findingId: "f1", turnNumber: 1 })],
      cardDb: { cardDbExists: true, cardCount: 10, withArenaIdCount: 5 },
      analysisRun: true,
    });
    expect(state.matchId).toBe("match-1");
    expect(state.analysisRun).toBe(true);
    expect(state.timeline.turns[0].findings).toHaveLength(1);
    expect(state.findings.ruleFindings).toHaveLength(1);
    expect(state.cardDb.imported).toBe(true);
  });
});
