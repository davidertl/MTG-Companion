import { describe, expect, it, vi } from "vitest";
import {
  ArchidektImportRouteError,
  buildArchidektImportRoute,
} from "../src/routes/integrations/archidekt/import";

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

  it("reuses a cached snapshot within the cache window", async () => {
    const fetcher = vi.fn(async (deckId: string) => ({
      source: "archidekt",
      deckId,
      name: "Cached Deck",
      updatedAt: "2026-05-06T21:16:00Z",
      cards: [],
    }));
    const route = buildArchidektImportRoute(fetcher, {
      cacheTtlMs: 60_000,
      now: () => 1_000,
    });

    await route("deck-1");
    await route("deck-1");

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps common not-found and rate-limit failures to typed route errors", async () => {
    const notFoundRoute = buildArchidektImportRoute(async () => {
      throw new Error("404 deck not found");
    });
    const rateLimitedRoute = buildArchidektImportRoute(async () => {
      throw new Error("429 rate limit reached");
    });

    await expect(notFoundRoute("deck-1")).rejects.toMatchObject<ArchidektImportRouteError>({
      status: 404,
      code: "archidekt-deck-not-found",
    });
    await expect(rateLimitedRoute("deck-1")).rejects.toMatchObject<ArchidektImportRouteError>({
      status: 429,
      code: "archidekt-rate-limited",
    });
  });
});
