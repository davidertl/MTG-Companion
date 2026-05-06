import { describe, expect, it } from "vitest";

import { cacheArchidektSnapshot, getCachedDeck } from "../src/lib/decks/cache";

describe("archidekt snapshot cache", () => {
  it("keeps imported deck snapshots available offline", () => {
    const cache = cacheArchidektSnapshot([], {
      source: "archidekt",
      deckId: "42",
      name: "Jund Midrange",
      updatedAt: "2026-05-06T21:20:00Z",
      cards: [{ name: "Go for the Throat", quantity: 2, category: "Mainboard" }],
    });

    expect(cache).toHaveLength(1);
    expect(getCachedDeck(cache, "42")?.name).toBe("Jund Midrange");
  });
});
