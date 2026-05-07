import { describe, expect, it } from "vitest";

import {
  createInMemoryEventStore,
  mediaSessionsRoute,
} from "../src/index";

describe("mediaSessionsRoute", () => {
  it("stores a separate media ingest contract for PaperC capture sessions", () => {
    const store = createInMemoryEventStore();

    const result = mediaSessionsRoute(
      {
        idempotencyKey: "media-batch-1",
        captureSession: {
          captureSessionId: "capture-1",
          sourceApp: "mancutg-paperc",
          platform: "camera-rig-a",
          cameraId: "cam-a",
          streamId: "table-12",
          startedAt: "2026-05-07T00:10:00Z",
          tournament: {
            tournamentId: "tour-1",
            roundId: "round-2",
            tableId: "table-12",
            matchId: "match-12",
            gameKey: "mtg-paper",
          },
        },
        artifacts: [
          {
            artifactId: "clip-1",
            tournamentId: "tour-1",
            roundId: "round-2",
            tableId: "table-12",
            matchId: "match-12",
            gameKey: "mtg-paper",
            captureSessionId: "capture-1",
            cameraId: "cam-a",
            artifactKind: "clip",
            uri: "s3://bucket/clip-1.mp4",
            mimeType: "video/mp4",
            capturedAt: "2026-05-07T00:11:00Z",
          },
        ],
      },
      store,
    );

    expect(result.createdSession).toBe(true);
    expect(result.acceptedArtifactCount).toBe(1);
    expect(result.totalStoredMediaSessions).toBe(1);
    expect(result.totalStoredMediaArtifacts).toBe(1);
  });

  it("deduplicates repeated media batches via idempotency key", () => {
    const store = createInMemoryEventStore();

    const request = {
      idempotencyKey: "media-batch-1",
      captureSession: {
        captureSessionId: "capture-1",
        sourceApp: "mancutg-paperc" as const,
        platform: "camera-rig-a",
        cameraId: "cam-a",
        streamId: "table-12",
        startedAt: "2026-05-07T00:10:00Z",
        tournament: {
          tournamentId: "tour-1",
          roundId: "round-2",
          tableId: "table-12",
          matchId: "match-12",
          gameKey: "mtg-paper",
        },
      },
      artifacts: [
        {
          artifactId: "clip-1",
          tournamentId: "tour-1",
          roundId: "round-2",
          tableId: "table-12",
          matchId: "match-12",
          gameKey: "mtg-paper",
          captureSessionId: "capture-1",
          cameraId: "cam-a",
          artifactKind: "clip" as const,
          uri: "s3://bucket/clip-1.mp4",
          mimeType: "video/mp4",
          capturedAt: "2026-05-07T00:11:00Z",
        },
      ],
    };

    mediaSessionsRoute(request, store);
    const second = mediaSessionsRoute(request, store);

    expect(second.duplicateBatch).toBe(true);
    expect(second.acceptedArtifactCount).toBe(0);
    expect(second.duplicateArtifactCount).toBe(1);
  });
});
