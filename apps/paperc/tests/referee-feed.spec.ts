import { describe, expect, it } from "vitest";

import type { AnalysisFinding } from "../../../packages/shared-schema/src/index";
import {
  createRefereeFeedState,
  orderedFeedItems,
  refereeFeedReducer,
  type IncomingFinding,
  type RefereeFeedState,
} from "../src/state/refereeFeed";

function finding(overrides: Partial<AnalysisFinding> & { findingId: string }): AnalysisFinding {
  return {
    gameKey: "game-1",
    turnNumber: 3,
    phase: "combat",
    kind: "rule-check",
    code: "extra-land-drop",
    severity: "possible-violation",
    confidence: 0.8,
    ruleRefs: ["CR 305.2"],
    description: "possible extra land drop",
    audience: "referee-only",
    engineVersion: "test-1",
    ...overrides,
  };
}

function incoming(f: AnalysisFinding, review?: IncomingFinding["review"]): IncomingFinding {
  return review === undefined ? { finding: f } : { finding: f, review };
}

function apply(
  state: RefereeFeedState,
  ...actions: Parameters<typeof refereeFeedReducer>[1][]
): RefereeFeedState {
  return actions.reduce(refereeFeedReducer, state);
}

describe("refereeFeedReducer — merge & dedupe", () => {
  it("dedupes by findingId across polls (latest finding wins)", () => {
    const state = apply(
      createRefereeFeedState(),
      { type: "merge", findings: [incoming(finding({ findingId: "f1", description: "v1" }))] },
      { type: "merge", findings: [incoming(finding({ findingId: "f1", description: "v2" }))] },
    );
    const items = orderedFeedItems(state);
    expect(items).toHaveLength(1);
    expect(items[0].finding.description).toBe("v2");
  });

  it("inserts new findings and keeps existing ones on subsequent polls", () => {
    const state = apply(
      createRefereeFeedState(),
      { type: "merge", findings: [incoming(finding({ findingId: "f1" }))] },
      { type: "merge", findings: [incoming(finding({ findingId: "f2", severity: "info" }))] },
    );
    expect(orderedFeedItems(state).map((i) => i.finding.findingId).sort()).toEqual(["f1", "f2"]);
  });

  it("records lastUpdatedAt and clears a prior poll error on a good merge", () => {
    const errored = refereeFeedReducer(createRefereeFeedState(), {
      type: "pollError",
      error: "offline",
    });
    expect(errored.lastError).toBe("offline");
    const merged = refereeFeedReducer(errored, {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
      at: "2026-07-06T10:00:00.000Z",
    });
    expect(merged.lastError).toBeNull();
    expect(merged.lastUpdatedAt).toBe("2026-07-06T10:00:00.000Z");
  });
});

describe("refereeFeedReducer — severity ordering", () => {
  it("orders possible-violation before warning before info", () => {
    const state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [
        incoming(finding({ findingId: "info", severity: "info" })),
        incoming(finding({ findingId: "viol", severity: "possible-violation" })),
        incoming(finding({ findingId: "warn", severity: "warning" })),
      ],
    });
    expect(orderedFeedItems(state).map((i) => i.finding.findingId)).toEqual([
      "viol",
      "warn",
      "info",
    ]);
  });

  it("breaks severity ties by confidence (highest first)", () => {
    const state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [
        incoming(finding({ findingId: "low", severity: "warning", confidence: 0.2 })),
        incoming(finding({ findingId: "high", severity: "warning", confidence: 0.9 })),
      ],
    });
    expect(orderedFeedItems(state).map((i) => i.finding.findingId)).toEqual(["high", "low"]);
  });

  it("is stable/deterministic regardless of arrival order", () => {
    const a = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [
        incoming(finding({ findingId: "b", severity: "info", confidence: 0.5 })),
        incoming(finding({ findingId: "a", severity: "info", confidence: 0.5 })),
      ],
    });
    // ids tie-break alphabetically when severity + confidence + turn all equal.
    expect(a.order).toEqual(["a", "b"]);
  });
});

describe("refereeFeedReducer — review & acknowledge", () => {
  it("tracks an in-flight review then applies the resolution", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, { type: "reviewStart", findingId: "f1" });
    expect(state.reviewing.f1).toBe(true);
    expect(state.items.f1.review).toBeNull();

    state = refereeFeedReducer(state, {
      type: "reviewSuccess",
      findingId: "f1",
      review: { resolution: "confirmed", reviewedBy: "rita" },
    });
    expect(state.reviewing.f1).toBeUndefined();
    expect(state.items.f1.review?.resolution).toBe("confirmed");
    expect(state.items.f1.review?.reviewedBy).toBe("rita");
  });

  it("clears the in-flight flag and records an error on review failure", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, { type: "reviewStart", findingId: "f1" });
    state = refereeFeedReducer(state, { type: "reviewError", findingId: "f1", error: "http 500" });
    expect(state.reviewing.f1).toBeUndefined();
    expect(state.lastError).toBe("http 500");
    expect(state.items.f1.review).toBeNull();
  });

  it("keeps an optimistic review through a later poll that omits it", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, {
      type: "reviewSuccess",
      findingId: "f1",
      review: { resolution: "dismissed", reviewedBy: "rita" },
    });
    // Next poll returns the finding with review: null (server not yet caught up).
    state = refereeFeedReducer(state, {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }), null)],
    });
    expect(state.items.f1.review?.resolution).toBe("dismissed");
  });

  it("prefers the server review when a poll carries one", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, {
      type: "merge",
      findings: [
        incoming(finding({ findingId: "f1" }), {
          resolution: "confirmed",
          reviewedBy: "rita",
          reviewedAt: "2026-07-06T10:05:00.000Z",
        }),
      ],
    });
    expect(state.items.f1.review?.reviewedAt).toBe("2026-07-06T10:05:00.000Z");
  });

  it("acknowledges locally and preserves the flag across merges", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, { type: "acknowledge", findingId: "f1" });
    expect(state.items.f1.acknowledged).toBe(true);
    // A refresh of the same finding must not drop the local acknowledgement.
    state = refereeFeedReducer(state, {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1", description: "updated" }))],
    });
    expect(state.items.f1.acknowledged).toBe(true);
    expect(state.items.f1.finding.description).toBe("updated");
  });

  it("resets to an empty feed", () => {
    let state = refereeFeedReducer(createRefereeFeedState(), {
      type: "merge",
      findings: [incoming(finding({ findingId: "f1" }))],
    });
    state = refereeFeedReducer(state, { type: "reset" });
    expect(orderedFeedItems(state)).toHaveLength(0);
    expect(state.lastError).toBeNull();
  });
});
