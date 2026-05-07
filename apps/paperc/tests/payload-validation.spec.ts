import { describe, expect, it } from "vitest";
import { buildPapercObservationPayload } from "../src/events/builders";

const validPayload = {
  tournamentId: "tour-1",
  roundId: "round-1",
  tableId: "table-1",
  matchId: "match-1",
  gameKey: "mtg-paper",
  captureSessionId: "capture-1",
  cameraId: "cam-1",
  videoSourceId: "source-1",
  observationKind: "board-state",
  details: {
    zone: "battlefield",
    cardName: "Island",
    sessionId: "session-1",
  },
  detections: [
    {
      detectionId: "d1",
      frameNo: 1,
      frameTimeMs: 32,
      zoneId: "battlefield",
      candidateName: "Island",
      confidence: 0.8,
      cardCount: 1,
    },
  ],
};

describe("PaperC observation payload validation", () => {
  it("accepts valid payloads", () => {
    const parsed = buildPapercObservationPayload(validPayload);
    expect(parsed.captureSessionId).toBe("capture-1");
  });

  it("rejects missing cardName", () => {
    expect(() =>
      buildPapercObservationPayload({
        ...validPayload,
        detections: [{ ...validPayload.detections[0], candidateName: "" }],
      }),
    ).toThrow();
  });

  it("rejects invalid zone", () => {
    expect(() =>
      buildPapercObservationPayload({
        ...validPayload,
        detections: [{ ...validPayload.detections[0], zoneId: "" }],
      }),
    ).toThrow();
  });

  it("rejects confidence out of bounds", () => {
    expect(() =>
      buildPapercObservationPayload({
        ...validPayload,
        detections: [{ ...validPayload.detections[0], confidence: 1.1 }],
      }),
    ).toThrow();
    expect(() =>
      buildPapercObservationPayload({
        ...validPayload,
        detections: [{ ...validPayload.detections[0], confidence: -0.1 }],
      }),
    ).toThrow();
  });

  it("rejects missing session id", () => {
    expect(() =>
      buildPapercObservationPayload({
        ...validPayload,
        captureSessionId: "",
      }),
    ).toThrow();
  });
});
