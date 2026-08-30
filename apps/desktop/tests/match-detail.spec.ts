import { describe, expect, it } from "vitest";

import { buildMatchDetailState } from "../src/routes/history/index";

describe("match detail state builder", () => {
  it("builds a per-event timeline from inspect_match output", () => {
    const state = buildMatchDetailState("match-1", [
      {
        sessionId: "s1",
        sequence: 1,
        timestamp: "2026-05-07T04:00:00Z",
        eventType: "MATCH_START",
        payloadJson: JSON.stringify({
          match_id: "match-1",
          deck: "Azorius",
          queue: "ranked",
        }),
      },
      {
        sessionId: "s1",
        sequence: 2,
        timestamp: "2026-05-07T04:05:00Z",
        eventType: "MATCH_END",
        payloadJson: JSON.stringify({ match_id: "match-1", result: "win" }),
      },
    ]);

    expect(state.matchId).toBe("match-1");
    expect(state.empty).toBe(false);
    expect(state.eventCount).toBe(2);
    expect(state.timeline[0].eventType).toBe("MATCH_START");
    // match_id is omitted from the summary; remaining fields are sorted.
    expect(state.timeline[0].summary).toBe("deck=Azorius, queue=ranked");
    expect(state.timeline[1].summary).toBe("result=win");
  });

  it("reports empty for a match with no events", () => {
    const state = buildMatchDetailState("missing", []);
    expect(state.empty).toBe(true);
    expect(state.eventCount).toBe(0);
    expect(state.timeline).toEqual([]);
  });

  it("degrades gracefully on non-JSON payloads", () => {
    const state = buildMatchDetailState("match-2", [
      {
        sessionId: "s1",
        sequence: 1,
        timestamp: "2026-05-07T04:00:00Z",
        eventType: "UNKNOWN",
        payloadJson: "not-json",
      },
    ]);
    expect(state.timeline[0].summary).toBe("not-json");
  });
});
