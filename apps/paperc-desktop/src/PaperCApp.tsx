import { useEffect, useMemo, useRef, useState } from "react";
import type { IngestBatchRequest } from "../../../packages/shared-schema/src/index";
import type { PapercFrameInput } from "../../paperc/src/runtime/types";
import {
  PapercRuntimePipeline,
  ScriptedWebcamFrameSource,
  snapshotToEvents,
  type PapercRuntimeConfig,
  type PapercRecognitionSnapshot,
} from "../../paperc/src/runtime";
import { JsonlLogWriter, LocalStorageJsonlStorage } from "./logging/jsonlLogWriter";
import { downloadJsonlFile } from "./logging/jsonlExport";
import { postIngestBatch } from "./sync/backendClient";

const REVIEW_THRESHOLD = 0.8;

const DEFAULT_CONFIG: PapercRuntimeConfig = {
  captureSessionId: "paperc-desktop-capture",
  sourceSessionId: "paperc-desktop-session",
  streamId: "local-table",
  modelVersion: "paper-model/0.1.0",
  startedAt: "2026-05-07T01:00:00.000Z",
  tournament: {
    tournamentId: "local-tournament",
    roundId: "round-1",
    tableId: "table-1",
    matchId: "match-1",
    gameKey: "mtg-paper",
  },
  video: {
    sourceId: "mock-camera-source",
    cameraId: "mock-camera",
    fps: 15,
    width: 1280,
    height: 720,
    rotateDeg: "0",
  },
  players: [
    { playerId: "player-a", displayName: "Player A", seatRef: "north" },
    { playerId: "player-b", displayName: "Player B", seatRef: "south" },
  ],
  zones: [
    {
      zoneId: "player-a-battlefield",
      zoneKind: "battlefield",
      ownerPlayerId: "player-a",
      rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    },
  ],
};

const DEFAULT_FRAMES: PapercFrameInput[] = [
  {
    frameNo: 1,
    frameTimeMs: 1000,
    width: 1280,
    height: 720,
    rawDetections: [{ zoneId: "player-a-battlefield", label: "island", confidence: 0.95, count: 1 }],
  },
  {
    frameNo: 2,
    frameTimeMs: 2000,
    width: 1280,
    height: 720,
    rawDetections: [{ zoneId: "player-a-battlefield", label: "island", confidence: 0.7, count: 1 }],
  },
];

export type PendingReview = {
  reviewId: string;
  cardName: string;
  confidence: number;
  sourceEventId: string;
};

export type DetectionTickResult = {
  batch: IngestBatchRequest | null;
  snapshot: PapercRecognitionSnapshot | null;
};

export interface PaperCRuntime {
  runDetectionTick: () => Promise<DetectionTickResult>;
  reset: () => void;
}

export type PaperCAppProps = {
  runtime?: PaperCRuntime;
  backendUrl?: string;
  tickDelayMs?: number;
  postBatch?: typeof postIngestBatch;
};

export function classifyLowConfidenceEvents(
  batch: IngestBatchRequest,
  threshold = REVIEW_THRESHOLD,
): PendingReview[] {
  return batch.events
    .filter((event) => (event.confidence ?? 1) < threshold)
    .map((event) => ({
      reviewId: `review-${event.eventId}`,
      cardName: String(
        ((event.payload as Record<string, unknown>).detections as Array<Record<string, unknown>> | undefined)?.[0]
          ?.candidateName ?? "Unknown",
      ),
      confidence: event.confidence ?? 0,
      sourceEventId: event.sourceEventId,
    }));
}

export function buildReviewRequestedLogEvent(review: PendingReview, occurredAt: string) {
  return {
    eventId: review.reviewId,
    sourceEventId: review.sourceEventId,
    eventType: "mtg.paper.review.requested",
    occurredAt,
    payload: {
      candidate: review.cardName,
      confidence: review.confidence,
      reason: "low_confidence",
      sourceEventId: review.sourceEventId,
    },
  };
}

export function buildConfirmedLogEvent(review: PendingReview, occurredAt: string) {
  return {
    eventId: `${review.reviewId}-confirmed`,
    sourceEventId: `${review.reviewId}-confirmed`,
    eventType: "mtg.paper.card.observed.confirmed",
    occurredAt,
    payload: {
      cardName: review.cardName,
      confirmedBy: "user",
      sourceEventId: review.sourceEventId,
    },
  };
}

function toIngestBatch(
  config: PapercRuntimeConfig,
  snapshot: PapercRecognitionSnapshot,
): IngestBatchRequest | null {
  const events = snapshotToEvents(config, snapshot);
  if (events.length === 0) {
    return null;
  }
  return {
    idempotencyKey: `${config.captureSessionId}-frame-${snapshot.frameNo}`,
    producer: {
      app: "mancutg-paperc",
      version: "0.1.0",
      instanceId: "paperc-desktop-local",
      displayName: "PaperC Desktop",
    },
    game: {
      gameKey: config.tournament.gameKey,
      gameFamily: "mtg",
      title: "Magic: The Gathering",
      mode: "paper",
    },
    session: {
      sourceSessionId: config.sourceSessionId,
      startedAt: config.startedAt,
      source: "camera",
      metadata: {
        streamId: config.streamId,
      },
    },
    events: events.map((event) => ({
      eventId: event.eventId,
      sourceEventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      seq: event.seq,
      actor: event.actor,
      object: event.object,
      targets: event.targets.map((target) => ({ ...target })),
      payload: event.payload,
      confidence: event.confidence,
      provenance: {
        source: "camera-frame",
        metadata: {},
        frameNo: event.provenance[0]?.frameNo,
        frameTimeMs: event.provenance[0]?.frameTimeMs,
        modelVersion: event.provenance[0]?.modelVersion,
      },
    })),
  };
}

export function createDefaultRuntime(
  config: PapercRuntimeConfig = DEFAULT_CONFIG,
  frames: PapercFrameInput[] = DEFAULT_FRAMES,
): PaperCRuntime {
  const pipeline = new PapercRuntimePipeline(config, ["Island", "Liliana's Triumph"]);
  return {
    async runDetectionTick() {
      const snapshot = await pipeline.runLiveTick(() => new ScriptedWebcamFrameSource(frames));
      return {
        snapshot,
        batch: snapshot ? toIngestBatch(config, snapshot) : null,
      };
    },
    reset() {
      pipeline.resetLiveSource();
    },
  };
}

export function PaperCApp({
  runtime = createDefaultRuntime(),
  backendUrl = "http://127.0.0.1:18080/v1/ingest/batches",
  tickDelayMs = 1000,
  postBatch = postIngestBatch,
}: PaperCAppProps) {
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingBatches, setPendingBatches] = useState<IngestBatchRequest[]>([]);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [noCameraFallback] = useState("No camera detected. Running in mock/manual mode.");
  const writerRef = useRef(new JsonlLogWriter(new LocalStorageJsonlStorage()));
  const [sessionLines, setSessionLines] = useState<string[]>([]);
  const sessionId = useMemo(() => DEFAULT_CONFIG.sourceSessionId, []);

  useEffect(() => {
    void writerRef.current.readSession(sessionId).then(setSessionLines);
  }, [sessionId]);

  async function appendBatchToLog(batch: IngestBatchRequest): Promise<void> {
    for (const event of batch.events) {
      await writerRef.current.appendEvent(sessionId, event);
    }
    const lines = await writerRef.current.readSession(sessionId);
    setSessionLines(lines);
  }

  async function runDetectionTick(): Promise<void> {
    const result = await runtime.runDetectionTick();
    const batch = result.batch;
    if (!batch) {
      return;
    }

    await appendBatchToLog(batch);

    const lowConfidence = classifyLowConfidenceEvents(batch);
    if (lowConfidence.length > 0) {
      for (const review of lowConfidence) {
        await writerRef.current.appendEvent(
          sessionId,
          buildReviewRequestedLogEvent(review, new Date().toISOString()),
        );
      }
      setPendingReviews((prev) => [...prev, ...lowConfidence]);
    }

    try {
      await postBatch(backendUrl, batch);
    } catch (error) {
      setPendingBatches((prev) => [...prev, batch]);
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  async function retryPending(): Promise<void> {
    const stillPending: IngestBatchRequest[] = [];
    for (const batch of pendingBatches) {
      try {
        await postBatch(backendUrl, batch);
      } catch {
        stillPending.push(batch);
      }
    }
    setPendingBatches(stillPending);
  }

  useEffect(() => {
    if (!running) {
      runtime.reset();
      return;
    }

    let cancelled = false;
    const runLoop = async () => {
      while (!cancelled) {
        try {
          await runDetectionTick();
        } catch (error) {
          setLastError(error instanceof Error ? error.message : String(error));
        }
        await new Promise((resolve) => window.setTimeout(resolve, tickDelayMs));
      }
    };
    void runLoop();

    return () => {
      cancelled = true;
    };
  }, [running, runtime, tickDelayMs]);

  async function handleAcceptReview(review: PendingReview): Promise<void> {
    await writerRef.current.appendEvent(sessionId, buildConfirmedLogEvent(review, new Date().toISOString()));
    const lines = await writerRef.current.readSession(sessionId);
    setSessionLines(lines);
    setPendingReviews((prev) => prev.filter((item) => item.reviewId !== review.reviewId));
  }

  function handleDiscardReview(review: PendingReview): void {
    setPendingReviews((prev) => prev.filter((item) => item.reviewId !== review.reviewId));
  }

  return (
    <main>
      <h1>PaperC Desktop</h1>
      <p>{noCameraFallback}</p>
      <div>
        <button type="button" onClick={() => setRunning((value) => !value)}>
          {running ? "Stop" : "Run"}
        </button>
        <button type="button" onClick={() => void runDetectionTick()}>
          Run detection tick
        </button>
        <button type="button" onClick={() => downloadJsonlFile(`paperc-session-${sessionId}.jsonl`, sessionLines)}>
          Export .jsonl
        </button>
        <button type="button" onClick={() => void retryPending()} disabled={pendingBatches.length === 0}>
          Retry pending ({pendingBatches.length})
        </button>
      </div>
      {lastError ? <p role="alert">{lastError}</p> : null}
      {pendingReviews.length > 0 ? (
        <section>
          <h2>Review required</h2>
          {pendingReviews.map((review) => (
            <article key={review.reviewId}>
              <p>Candidate: {review.cardName}</p>
              <p>Confidence: {review.confidence.toFixed(2)}</p>
              <button type="button" onClick={() => handleAcceptReview(review)}>
                Accept
              </button>
              <button type="button" onClick={() => handleAcceptReview(review)}>
                Correct
              </button>
              <button type="button" onClick={() => handleDiscardReview(review)}>
                Discard
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
