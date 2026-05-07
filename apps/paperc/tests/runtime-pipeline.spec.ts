import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createInMemoryEventStore, eventsRoute } from "../../../services/api/src/index";
import {
  PapercRuntimePipeline,
  ScriptedWebcamFrameSource,
  benchmarkIdentifier,
  buildPapercEventBatchFromSnapshot,
  type PapercRuntimeConfig,
} from "../src/index";
import { ingestBatchRequestSchema } from "../../../packages/shared-schema/src/index";

const config: PapercRuntimeConfig = {
  captureSessionId: "capture-a",
  sourceSessionId: "session-a",
  streamId: "table-12",
  modelVersion: "paper-model/0.1.0",
  startedAt: "2026-05-07T01:00:00Z",
  tournament: {
    tournamentId: "tour-1",
    roundId: "round-4",
    tableId: "table-12",
    matchId: "match-12",
    gameKey: "mtg-paper",
  },
  video: {
    sourceId: "webcam-0",
    cameraId: "cam-a",
    fps: 15,
    width: 1280,
    height: 720,
    rotateDeg: "0",
  },
  players: [
    { playerId: "p1", displayName: "Alice", seatRef: "north" },
    { playerId: "p2", displayName: "Bob", seatRef: "south" },
  ],
  zones: [
    {
      zoneId: "p1-battlefield",
      zoneKind: "battlefield",
      ownerPlayerId: "p1",
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
    },
  ],
};

describe("PaperC runtime pipeline", () => {
  it("produces a normalized event batch accepted by backend route", async () => {
    const source = new ScriptedWebcamFrameSource([
      {
        frameNo: 1,
        frameTimeMs: 64,
        width: 1280,
        height: 720,
        rawDetections: [{ zoneId: "p1-battlefield", label: "island", confidence: 0.99, count: 1 }],
      },
    ]);
    const pipeline = new PapercRuntimePipeline(config, ["Island", "Mountain"]);
    const snapshot = await pipeline.runOnce(source);
    expect(snapshot).not.toBeNull();
    const batch = buildPapercEventBatchFromSnapshot(config, snapshot!);
    expect(batch).not.toBeNull();
    const store = createInMemoryEventStore();
    const result = eventsRoute(batch!, store);
    expect(result.acceptedSessionCount).toBe(1);
    expect(result.acceptedEventCount).toBe(1);
  });

  it("benchmarks identifier recall on labelled samples", () => {
    const result = benchmarkIdentifier(config, ["Island", "Sol Ring"], [
      {
        frame: {
          frameNo: 1,
          frameTimeMs: 50,
          width: 1280,
          height: 720,
          rawDetections: [{ zoneId: "p1-battlefield", label: "island", confidence: 0.92, count: 1 }],
        },
        expectedCardNames: ["Island"],
      },
      {
        frame: {
          frameNo: 2,
          frameTimeMs: 100,
          width: 1280,
          height: 720,
          rawDetections: [{ zoneId: "p1-battlefield", label: "sol ring", confidence: 0.95, count: 1 }],
        },
        expectedCardNames: ["Sol Ring"],
      },
    ]);

    expect(result.frameCount).toBe(2);
    expect(result.recall).toBe(1);
    expect(result.exactMatchFrames).toBe(2);
  });

  it("parses PaperC producer ingest batch contract", () => {
    const fixture = JSON.parse(
      readFileSync(
        "services/api/tests/fixtures/ingest-batches/paperc-minimal.json",
        "utf8",
      ),
    );
    const parsed = ingestBatchRequestSchema.parse(fixture);

    expect(parsed.producer.instanceId).toBe("windows-device-1");
    expect(parsed.game.mode).toBe("paper");
    expect(parsed.events[0].sourceEventId).toBe("paper-session-123-obs-1-0");
  });
});
