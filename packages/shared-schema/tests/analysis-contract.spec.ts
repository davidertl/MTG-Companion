import { describe, expect, it } from "vitest";

import {
  ANALYSIS_FINDING_RAISED_EVENT_TYPE,
  ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
  ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
  analysisEventTypeSchema,
  analysisFindingReviewedPayloadSchema,
  analysisFindingSchema,
  backendEventEnvelopeSchema,
  validateAnalysisEventContract,
} from "../src/index.ts";

function validFinding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "finding-1",
    gameKey: "mtg-arena",
    turnNumber: 4,
    phase: "combat",
    kind: "rule-check",
    code: "extra-land-drop",
    severity: "possible-violation",
    confidence: 0.9,
    ruleRefs: ["CR 305.2"],
    description: "Player played more than one land this turn.",
    audience: "referee-only",
    engineVersion: "core-analysis/0.1.0",
    ...overrides,
  };
}

function analysisEnvelope(overrides: Record<string, unknown> = {}) {
  return backendEventEnvelopeSchema.parse({
    eventId: "analysis-1",
    sourceApp: "mancutg-arenac",
    sourceSessionId: "arena-session-1",
    eventType: ANALYSIS_FINDING_RAISED_EVENT_TYPE,
    occurredAt: "2026-07-06T10:00:00Z",
    matchId: "match-1",
    provenance: [
      {
        sourceKind: "arena-log",
        sourceSessionId: "arena-session-1",
      },
    ],
    payload: validFinding(),
    ...overrides,
  });
}

describe("analysisFindingSchema", () => {
  it("parses a valid finding", () => {
    const finding = analysisFindingSchema.parse(validFinding());

    expect(finding.findingId).toBe("finding-1");
    expect(finding.kind).toBe("rule-check");
    expect(finding.severity).toBe("possible-violation");
    expect(finding.confidence).toBe(0.9);
    expect(finding.ruleRefs).toEqual(["CR 305.2"]);
    expect(finding.audience).toBe("referee-only");
  });

  it("keeps code an open string so unknown codes from newer engines still parse", () => {
    const finding = analysisFindingSchema.parse(
      validFinding({ code: "some-future-check-not-in-any-registry" }),
    );

    expect(finding.code).toBe("some-future-check-not-in-any-registry");
  });

  it("defaults audience to players when omitted", () => {
    const input = validFinding();
    delete (input as Record<string, unknown>).audience;

    const finding = analysisFindingSchema.parse(input);

    expect(finding.audience).toBe("players");
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      analysisFindingSchema.parse(validFinding({ confidence: 1.2 })),
    ).toThrow();
    expect(() =>
      analysisFindingSchema.parse(validFinding({ confidence: -0.1 })),
    ).toThrow();
  });

  it("rejects unknown severity and kind values", () => {
    expect(() =>
      analysisFindingSchema.parse(validFinding({ severity: "violation" })),
    ).toThrow();
    expect(() =>
      analysisFindingSchema.parse(validFinding({ kind: "verdict" })),
    ).toThrow();
  });
});

describe("analysis event types", () => {
  it("exposes the three analysis event type constants", () => {
    expect(ANALYSIS_FINDING_RAISED_EVENT_TYPE).toBe("analysis.finding.raised");
    expect(ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE).toBe(
      "analysis.suggestion.raised",
    );
    expect(ANALYSIS_FINDING_REVIEWED_EVENT_TYPE).toBe(
      "analysis.finding.reviewed",
    );
    expect(analysisEventTypeSchema.options).toEqual([
      "analysis.finding.raised",
      "analysis.suggestion.raised",
      "analysis.finding.reviewed",
    ]);
  });
});

describe("validateAnalysisEventContract", () => {
  it("accepts a finding raised by the local analysis engine (arenac)", () => {
    const event = validateAnalysisEventContract(analysisEnvelope());

    expect(event.eventType).toBe(ANALYSIS_FINDING_RAISED_EVENT_TYPE);
    expect((event.payload as { audience: string }).audience).toBe(
      "referee-only",
    );
  });

  it("accepts a suggestion raised by the backend", () => {
    const event = validateAnalysisEventContract(
      analysisEnvelope({
        eventId: "analysis-2",
        sourceApp: "mancutg-backend",
        sourceSessionId: "backend-session-1",
        eventType: ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
        provenance: [
          {
            sourceKind: "backend-process",
            sourceSessionId: "backend-session-1",
          },
        ],
        payload: validFinding({
          kind: "suggestion",
          code: "lethal-available",
          severity: "info",
        }),
      }),
    );

    expect((event.payload as { kind: string }).kind).toBe("suggestion");
  });

  it("rejects analysis events emitted by paperc clients", () => {
    expect(() =>
      validateAnalysisEventContract(
        analysisEnvelope({ sourceApp: "mancutg-paperc" }),
      ),
    ).toThrow(/mancutg-paperc is not allowed to emit analysis.finding.raised/);
  });

  it("rejects a rule-check payload on the suggestion event type and vice versa", () => {
    expect(() =>
      validateAnalysisEventContract(
        analysisEnvelope({
          eventType: ANALYSIS_SUGGESTION_RAISED_EVENT_TYPE,
          payload: validFinding({ kind: "rule-check" }),
        }),
      ),
    ).toThrow();
    expect(() =>
      validateAnalysisEventContract(
        analysisEnvelope({
          payload: validFinding({ kind: "suggestion" }),
        }),
      ),
    ).toThrow();
  });

  it("validates review payloads for analysis.finding.reviewed", () => {
    const event = validateAnalysisEventContract(
      analysisEnvelope({
        eventType: ANALYSIS_FINDING_REVIEWED_EVENT_TYPE,
        payload: analysisFindingReviewedPayloadSchema.parse({
          findingId: "finding-1",
          gameKey: "mtg-arena",
          resolution: "dismissed",
          reviewedBy: "referee-1",
        }),
      }),
    );

    expect((event.payload as { resolution: string }).resolution).toBe(
      "dismissed",
    );
  });

  it("passes non-analysis events through unchanged", () => {
    const event = analysisEnvelope({
      eventType: "match.completed",
      payload: { anything: "goes" },
    });

    expect(validateAnalysisEventContract(event)).toEqual(event);
  });
});
