import { describe, expect, it } from "vitest";

import {
  buildCaptureSession,
  buildPapercEventBatch,
  buildPapercMediaRequest,
  buildTournamentContext,
} from "../src/index";

describe("MancuTG-PaperC minimal contract skeleton", () => {
  it("builds valid tournament, capture, event, and media payloads", () => {
    const tournament = buildTournamentContext({
      tournamentId: "tour-1",
      roundId: "round-4",
      tableId: "table-12",
      matchId: "match-12",
      gameKey: "mtg-paper",
    });

    const captureSession = buildCaptureSession({
      captureSessionId: "capture-1",
      sourceApp: "mancutg-paperc",
      platform: "camera-rig-a",
      cameraId: "cam-a",
      streamId: "table-12",
      startedAt: "2026-05-07T01:00:00Z",
      tournament,
    });

    const batch = buildPapercEventBatch({
      sessions: [
        {
          sourceSessionId: "paper-session-1",
          sourceApp: "mancutg-paperc",
          sourceKind: "paper-camera",
          platform: "camera-rig-a",
          gameMode: "paper",
          startedAt: "2026-05-07T01:00:00Z",
          streamId: "table-12",
          metadata: {
            capture: {
              ...tournament,
              captureSessionId: "capture-1",
              cameraId: "cam-a",
            },
          },
        },
      ],
      events: [
        {
          eventId: "paperc-obs-1",
          sourceApp: "mancutg-paperc",
          sourceSessionId: "paper-session-1",
          eventType: "paperc.observation.detected",
          occurredAt: "2026-05-07T01:01:00Z",
          streamId: "table-12",
          provenance: [
            {
              sourceKind: "paper-camera",
              sourceSessionId: "paper-session-1",
              cameraId: "cam-a",
              frameNo: 1,
            },
          ],
          payload: {
            ...tournament,
            captureSessionId: "capture-1",
            cameraId: "cam-a",
            observationKind: "board-state",
            details: {},
          },
        },
      ],
    });

    const media = buildPapercMediaRequest(
      captureSession,
      [
        {
          artifactId: "clip-1",
          ...tournament,
          captureSessionId: "capture-1",
          cameraId: "cam-a",
          artifactKind: "clip",
          uri: "s3://bucket/clip-1.mp4",
          mimeType: "video/mp4",
          capturedAt: "2026-05-07T01:02:00Z",
        },
      ],
      "media-batch-1",
    );

    expect(batch.events).toHaveLength(1);
    expect(media.captureSession.captureSessionId).toBe("capture-1");
  });

  it("rejects paper events without tournament context", () => {
    expect(() =>
      buildPapercEventBatch({
        sessions: [
          {
            sourceSessionId: "paper-session-1",
            sourceApp: "mancutg-paperc",
            sourceKind: "paper-camera",
            platform: "camera-rig-a",
            gameMode: "paper",
            startedAt: "2026-05-07T01:00:00Z",
            streamId: "table-12",
            metadata: {
              capture: {
                tournamentId: "tour-1",
                roundId: "round-4",
                tableId: "table-12",
                matchId: "match-12",
                gameKey: "mtg-paper",
                captureSessionId: "capture-1",
                cameraId: "cam-a",
              },
            },
          },
        ],
        events: [
          {
            eventId: "paperc-obs-1",
            sourceApp: "mancutg-paperc",
            sourceSessionId: "paper-session-1",
            eventType: "paperc.observation.detected",
            occurredAt: "2026-05-07T01:01:00Z",
            provenance: [
              {
                sourceKind: "paper-camera",
                sourceSessionId: "paper-session-1",
                cameraId: "cam-a",
              },
            ],
            payload: {
              captureSessionId: "capture-1",
              cameraId: "cam-a",
              observationKind: "board-state",
              details: {},
            },
          },
        ],
      }),
    ).toThrow();
  });
});
