import { describe, expect, it } from "vitest";

import { buildDecksRouteState } from "../src/routes/decks/index";

describe("decks route state", () => {
  it("surfaces read-only Archidekt import when consent is enabled", () => {
    const state = buildDecksRouteState(
      [
        {
          source: "archidekt",
          deckId: "42",
          name: "Jund Midrange",
          updatedAt: "2026-05-07T03:00:00Z",
          cards: [],
        },
      ],
      { archidektEnabled: true },
    );

    expect(state.archidektEnabled).toBe(true);
    expect(state.readOnlyImport).toBe(true);
    expect(state.importActionLabel).toContain("read-only");
  });

  it("shows a consent message when Archidekt access is disabled", () => {
    const state = buildDecksRouteState([], { archidektEnabled: false });

    expect(state.archidektEnabled).toBe(false);
    expect(state.statusMessage).toContain("offline");
  });
});
