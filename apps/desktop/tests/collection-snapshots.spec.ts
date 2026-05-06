import { describe, expect, it } from "vitest";

import { getCollectionRouteState } from "../src/routes/collection/index";

describe("collection route state", () => {
  it("shows the latest known local collection snapshot", () => {
    const state = getCollectionRouteState({
      cardsOwned: 620,
      capturedAt: "2026-05-06T21:07:00Z",
    });

    expect(state.empty).toBe(false);
    expect(state.cardsOwned).toBe(620);
    expect(state.capturedAt).toBe("2026-05-06T21:07:00Z");
  });

  it("provides a valid empty state when no collection snapshot exists", () => {
    const state = getCollectionRouteState(undefined);

    expect(state.empty).toBe(true);
    expect(state.cardsOwned).toBe(0);
  });
});
