import { describe, expect, it } from "vitest";
import { PapercRuntimePipeline } from "../src/runtime/pipeline";
import { ScriptedWebcamFrameSource } from "../src/runtime/capture";
import type { PapercRuntimeConfig } from "../src/runtime/types";

const config: PapercRuntimeConfig = {
  captureSessionId: "capture-loop",
  sourceSessionId: "session-loop",
  streamId: "table-loop",
  modelVersion: "paper-model/0.1.0",
  startedAt: "2026-05-07T01:00:00Z",
  tournament: {
    tournamentId: "tour-1",
    roundId: "round-1",
    tableId: "table-1",
    matchId: "match-1",
    gameKey: "mtg-paper",
  },
  video: {
    sourceId: "webcam-0",
    cameraId: "cam-1",
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
      rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    },
  ],
};

describe("PaperC live loop runtime", () => {
  it("keeps frame source state monotonic across ticks", async () => {
    const pipeline = new PapercRuntimePipeline(config, ["Island"]);
    const frames = [
      {
        frameNo: 1,
        frameTimeMs: 1000,
        width: 1280,
        height: 720,
        rawDetections: [{ zoneId: "p1-battlefield", label: "island", confidence: 0.95, count: 1 }],
      },
      {
        frameNo: 2,
        frameTimeMs: 2000,
        width: 1280,
        height: 720,
        rawDetections: [{ zoneId: "p1-battlefield", label: "island", confidence: 0.95, count: 1 }],
      },
    ];
    const factory = () => new ScriptedWebcamFrameSource(frames);
    const first = await pipeline.runLiveTick(factory);
    const second = await pipeline.runLiveTick(factory);
    expect(first?.frameNo).toBe(1);
    expect(second?.frameNo).toBe(2);
  });

  it("resets source after cancellation", async () => {
    const pipeline = new PapercRuntimePipeline(config, ["Island"]);
    const frames = [
      {
        frameNo: 1,
        frameTimeMs: 1000,
        width: 1280,
        height: 720,
        rawDetections: [{ zoneId: "p1-battlefield", label: "island", confidence: 0.95, count: 1 }],
      },
    ];
    const factory = () => new ScriptedWebcamFrameSource(frames);
    await pipeline.runLiveTick(factory);
    pipeline.resetLiveSource();
    const afterReset = await pipeline.runLiveTick(factory);
    expect(afterReset?.frameNo).toBe(1);
  });
});
