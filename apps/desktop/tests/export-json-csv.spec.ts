import { describe, expect, it } from "vitest";
import {
  exportBackupBundleAsJson,
  exportHistoryAsCsv,
  exportHistoryAsJson,
} from "../src/lib/export/index";

describe("exporters", () => {
  const history = [
    { matchId: "m-1", deck: "Azorius Control", result: "win" as const, queue: "ranked" },
    { matchId: "m-2", deck: "Boros Convoke", result: "loss" as const, queue: "play" },
  ];

  it("exports history as JSON", () => {
    const output = exportHistoryAsJson(history);
    expect(JSON.parse(output)).toEqual(history);
  });

  it("exports history as CSV", () => {
    const output = exportHistoryAsCsv([
      ...history,
      {
        matchId: "m-3",
        deck: 'Deck, "v2"',
        result: "win" as const,
        queue: "ranked\nopen",
      },
    ]);
    expect(output).toBe(
      [
        "matchId,deck,result,queue",
        '"m-1","Azorius Control","win","ranked"',
        '"m-2","Boros Convoke","loss","play"',
        '"m-3","Deck, ""v2""","win","ranked\nopen"',
      ].join("\n"),
    );
  });

  it("exports backup bundles as formatted JSON", () => {
    const output = exportBackupBundleAsJson({
      sessions: [{ sessionId: "session-1" }],
      matchHistory: history,
    });

    expect(JSON.parse(output)).toEqual({
      sessions: [{ sessionId: "session-1" }],
      matchHistory: history,
    });
  });
});
