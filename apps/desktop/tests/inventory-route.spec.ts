import { describe, expect, it } from "vitest";

import { buildInventoryRouteState } from "../src/routes/inventory/index";

describe("inventory route state", () => {
  it("shows the latest known local inventory snapshot", () => {
    const state = buildInventoryRouteState({
      gold: 1200,
      gems: 400,
      wildcards: 12,
      vault: 34,
      capturedAt: "2026-05-07T02:08:00Z",
    });

    expect(state.empty).toBe(false);
    expect(state.gold).toBe(1200);
    expect(state.gems).toBe(400);
    expect(state.capturedAt).toBe("2026-05-07T02:08:00Z");
  });

  it("provides a valid empty inventory state when no snapshot exists", () => {
    const state = buildInventoryRouteState(undefined);

    expect(state.empty).toBe(true);
    expect(state.gold).toBe(0);
    expect(state.message).toContain("Noch keine lokale Inventory");
  });
});
