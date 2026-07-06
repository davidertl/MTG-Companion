import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MatchDetail } from "../src/routes/history/MatchDetail";
import {
  buildMatchAnalysisState,
  buildMatchDetailState,
} from "../src/routes/history/index";
import type { RustFinding, RustGameTimeline } from "../src/lib/tauri/commands";

function detailState() {
  return buildMatchDetailState("match-1", [
    {
      sessionId: "s1",
      sequence: 1,
      timestamp: "2026-05-07T04:00:00Z",
      eventType: "MATCH_START",
      payloadJson: JSON.stringify({ match_id: "match-1", deck: "Azorius" }),
    },
  ]);
}

function timeline(): RustGameTimeline {
  return {
    turns: [
      {
        turnNumber: 1,
        activePlayer: "playerA",
        phase: "main1",
        zones: {},
        lifeTotals: { playerA: 20, playerB: 20 },
        actions: [],
      },
      {
        turnNumber: 2,
        activePlayer: "playerB",
        phase: "main1",
        zones: {},
        lifeTotals: { playerA: 20, playerB: 20 },
        actions: [],
      },
      {
        turnNumber: 3,
        activePlayer: "playerA",
        phase: "combat",
        zones: {},
        lifeTotals: { playerA: 20, playerB: 18 },
        actions: [],
      },
    ],
    completeness: { kind: "complete" },
    notes: [],
  };
}

function finding(overrides: Partial<RustFinding>): RustFinding {
  return {
    findingId: "f",
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

describe("MatchDetail analysis rendering", () => {
  it("renders finding markers on their correct turns", () => {
    const analysis = buildMatchAnalysisState({
      matchId: "match-1",
      timeline: timeline(),
      findings: [
        finding({ findingId: "f1", code: "extra-land-drop", turnNumber: 1 }),
        finding({ findingId: "f3", code: "illegal-attack", turnNumber: 3 }),
      ],
      cardDb: { cardDbExists: true, cardCount: 10, withArenaIdCount: 5 },
      analysisRun: true,
    });

    const html = renderToStaticMarkup(
      <MatchDetail state={detailState()} analysis={analysis} />,
    );

    // Each turn is a distinct block; each finding renders with its code.
    expect(html).toContain('data-turn="1"');
    expect(html).toContain('data-turn="3"');
    expect(html).toContain('data-finding-code="extra-land-drop"');
    expect(html).toContain('data-finding-code="illegal-attack"');

    // Marker for turn 1 sits inside the turn-1 block, ahead of turn 3's marker.
    const turn1Index = html.indexOf('data-turn="1"');
    const turn3Index = html.indexOf('data-turn="3"');
    const landIndex = html.indexOf('data-finding-code="extra-land-drop"');
    const attackIndex = html.indexOf('data-finding-code="illegal-attack"');
    expect(landIndex).toBeGreaterThan(turn1Index);
    expect(landIndex).toBeLessThan(turn3Index);
    expect(attackIndex).toBeGreaterThan(turn3Index);
  });

  it("shows confidence and rule refs verbatim with non-overclaiming language", () => {
    const analysis = buildMatchAnalysisState({
      matchId: "match-1",
      timeline: timeline(),
      findings: [finding({ findingId: "f1", turnNumber: 1 })],
      cardDb: { cardDbExists: true, cardCount: 10, withArenaIdCount: 5 },
      analysisRun: true,
    });
    const html = renderToStaticMarkup(
      <MatchDetail state={detailState()} analysis={analysis} />,
    );
    expect(html).toContain("Possible rule-break");
    expect(html).toContain("Confidence 0.62 (62%)");
    expect(html).toContain("CR 305.2");
    expect(html).not.toContain("cheat");
  });

  it("shows card-DB import guidance when no card DB is imported", () => {
    const analysis = buildMatchAnalysisState({
      matchId: "match-1",
      timeline: timeline(),
      findings: [],
      cardDb: null,
      analysisRun: false,
    });
    const html = renderToStaticMarkup(
      <MatchDetail state={detailState()} analysis={analysis} />,
    );
    expect(html).toContain("import-card-db");
    expect(html).toContain("Run analysis");
  });

  it("hides the run-analysis affordance when analysis is disabled", () => {
    const analysis = buildMatchAnalysisState({
      matchId: "match-1",
      timeline: timeline(),
      findings: [],
      cardDb: { cardDbExists: true, cardCount: 10, withArenaIdCount: 5 },
      analysisRun: false,
    });
    const html = renderToStaticMarkup(
      <MatchDetail state={detailState()} analysis={analysis} analysisEnabled={false} />,
    );
    // The button (">Run analysis<") is gone; the suggestions hint prose may
    // still mention analysis, so target the button text specifically.
    expect(html).not.toContain(">Run analysis<");
    expect(html).toContain("Analysis disabled in Settings");
  });
});
