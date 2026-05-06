import { describe, expect, it } from "vitest";

import { buildHistoryRouteState } from "../src/lib/query/history";

describe("history route", () => {
  it("shows empty state when no matches exist", () => {
    const state = buildHistoryRouteState([]);

    expect(state.empty).toBe(true);
    expect(state.totalMatches).toBe(0);
    expect(state.lastDeck).toBeNull();
  });

  it("derives the last seen deck from local match history", () => {
    const state = buildHistoryRouteState([
      { matchId: "m1", deck: "Azorius Control", result: "win", queue: "ranked" },
      { matchId: "m2", deck: "Jeskai Convoke", result: "loss", queue: "play" },
    ]);

    expect(state.empty).toBe(false);
    expect(state.totalMatches).toBe(2);
    expect(state.lastDeck).toBe("Jeskai Convoke");
  });
});
