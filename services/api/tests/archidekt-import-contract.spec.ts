import { describe, expect, it } from "vitest";
import { buildArchidektImportRoute } from "../src/routes/integrations/archidekt/import";

describe("archidekt import contract", () => {
  it("accepts validated connector payloads", async () => {
    const route = buildArchidektImportRoute(async (deckId) => ({
      source: "archidekt",
      deckId,
      name: "Boros Convoke",
      updatedAt: "2026-05-06T21:16:00Z",
      cards: [{ name: "Knight-Errant of Eos", quantity: 4, category: "mainboard" }],
    }));

    await expect(route("deck-1")).resolves.toMatchObject({
      source: "archidekt",
      deckId: "deck-1",
      name: "Boros Convoke",
    });
  });

  it("rejects malformed connector payloads", async () => {
    const route = buildArchidektImportRoute(async () => ({
      source: "archidekt",
      deckId: "",
      name: "",
      updatedAt: "invalid",
      cards: [],
    }));

    await expect(route("deck-1")).rejects.toThrow();
  });

  it("rejects connector payloads for a different deck than requested", async () => {
    const route = buildArchidektImportRoute(async () => ({
      source: "archidekt",
      deckId: "other-deck",
      name: "Wrong Deck",
      updatedAt: "2026-05-06T21:16:00Z",
      cards: [{ name: "Knight-Errant of Eos", quantity: 4, category: "mainboard" }],
    }));

    await expect(route("deck-1")).rejects.toThrow("requested deck");
  });
});
