import { describe, expect, it } from "vitest";
import { createInMemorySyncStore, syncRoute } from "../src/index";

describe("syncRoute", () => {
  it("accepts valid sync objects in anonymous mode without breaking local-first semantics", () => {
    const store = createInMemorySyncStore();
    const response = syncRoute(
      [
        {
          objectType: "deck_snapshot",
          objectId: "deck-1",
          payload: { name: "Azorius Control" },
          dirty: true,
          lastError: null,
        },
      ],
      undefined,
      store,
    );

    expect(response.sessionMode).toBe("anonymous");
    expect(response.accepted).toHaveLength(1);
    expect(store.values).toHaveLength(1);
    expect(store.values[0]).toMatchObject({
      objectType: "deck_snapshot",
      objectId: "deck-1",
      payload: { name: "Azorius Control" },
    });
  });

  it("overwrites existing objects while preserving unrelated state", () => {
    const store = createInMemorySyncStore();

    syncRoute(
      [
        {
          objectType: "deck_snapshot",
          objectId: "deck-1",
          payload: { name: "Old Deck" },
          dirty: true,
          lastError: null,
        },
        {
          objectType: "inventory_snapshot",
          objectId: "inventory-1",
          payload: { gold: 1200 },
          dirty: true,
          lastError: null,
        },
      ],
      undefined,
      store,
    );

    syncRoute(
      [
        {
          objectType: "deck_snapshot",
          objectId: "deck-1",
          payload: { name: "Updated Deck" },
          dirty: false,
          lastError: null,
        },
      ],
      "token-123",
      store,
    );

    expect(store.values).toHaveLength(2);
    expect(store.values).toContainEqual(
      expect.objectContaining({
        objectType: "deck_snapshot",
        objectId: "deck-1",
        payload: { name: "Updated Deck" },
      }),
    );
    expect(store.values).toContainEqual(
      expect.objectContaining({
        objectType: "inventory_snapshot",
        objectId: "inventory-1",
        payload: { gold: 1200 },
      }),
    );
  });

  it("rejects malformed sync payloads as a whole request", () => {
    const store = createInMemorySyncStore();

    expect(() =>
      syncRoute(
        [
          {
            objectType: "deck_snapshot",
            objectId: "deck-1",
            payload: { name: "Valid Deck" },
            dirty: true,
            lastError: null,
          },
          {
            objectType: "deck_snapshot",
            objectId: 42,
            payload: { name: "Broken Deck" },
            dirty: true,
            lastError: null,
          },
        ],
        undefined,
        store,
      ),
    ).toThrow();
    expect(store.values).toHaveLength(0);
  });
});
