import { describe, expect, it } from "vitest";
import type { IngestBatchRequest } from "../../../packages/shared-schema/src/index";
import {
  buildConfirmedLogEvent,
  buildReviewRequestedLogEvent,
  classifyLowConfidenceEvents,
  type PendingReview,
} from "../../paperc-desktop/src/PaperCApp";

function buildBatch(confidence: number): IngestBatchRequest {
  return {
    idempotencyKey: "batch-review",
    producer: {
      app: "mancutg-paperc",
      version: "0.1.0",
      instanceId: "device-1",
    },
    game: {
      gameKey: "mtg-paper",
      gameFamily: "mtg",
      title: "Magic: The Gathering",
      mode: "paper",
    },
    session: {
      sourceSessionId: "session-1",
      startedAt: "2026-05-07T01:00:00.000Z",
      source: "camera",
      metadata: {},
    },
    events: [
      {
        eventId: "evt-1",
        sourceEventId: "evt-1",
        eventType: "paperc.observation.detected",
        occurredAt: "2026-05-07T01:00:01.000Z",
        payload: {
          detections: [{ candidateName: "Island" }],
        },
        confidence,
        targets: [],
        provenance: { source: "camera-frame", metadata: {} },
      },
    ],
  };
}

describe("review flow", () => {
  it("high-confidence stays out of review queue", () => {
    const reviews = classifyLowConfidenceEvents(buildBatch(0.95));
    expect(reviews).toHaveLength(0);
  });

  it("threshold boundary is deterministic", () => {
    const reviews = classifyLowConfidenceEvents(buildBatch(0.8), 0.8);
    expect(reviews).toHaveLength(0);
  });

  it("low-confidence remains pending without resolution", () => {
    const reviews = classifyLowConfidenceEvents(buildBatch(0.4));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].sourceEventId).toBe("evt-1");
  });

  it("accept emits confirmedBy user event", () => {
    const review: PendingReview = {
      reviewId: "review-evt-1",
      cardName: "Island",
      confidence: 0.4,
      sourceEventId: "evt-1",
    };
    const requested = buildReviewRequestedLogEvent(review, "2026-05-07T01:00:02.000Z");
    const confirmed = buildConfirmedLogEvent(review, "2026-05-07T01:00:03.000Z");

    expect(requested.eventType).toBe("mtg.paper.review.requested");
    expect(confirmed.eventType).toBe("mtg.paper.card.observed.confirmed");
    expect((confirmed.payload as { confirmedBy: string }).confirmedBy).toBe("user");
  });
});
