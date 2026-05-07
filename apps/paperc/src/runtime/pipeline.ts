import { preprocessFrame, type WebcamFrameSource } from "./capture";
import { CardIdentifierEngine } from "./recognizer";
import {
  papercRecognitionSnapshotSchema,
  papercRuntimeConfigSchema,
  type PapercRecognitionSnapshot,
  type PapercRuntimeConfig,
} from "./types";

export class PapercRuntimePipeline {
  private readonly config: PapercRuntimeConfig;
  private readonly recognizer: CardIdentifierEngine;

  constructor(config: PapercRuntimeConfig, cardPool: string[]) {
    this.config = papercRuntimeConfigSchema.parse(config);
    this.recognizer = new CardIdentifierEngine(this.config, cardPool);
  }

  async runOnce(source: WebcamFrameSource): Promise<PapercRecognitionSnapshot | null> {
    const frame = await source.nextFrame();
    if (!frame) {
      return null;
    }
    const startedAt = Date.now();
    const normalized = preprocessFrame(frame);
    const detections = this.recognizer.identify(normalized);
    const snapshot = papercRecognitionSnapshotSchema.parse({
      frameNo: normalized.frameNo,
      frameTimeMs: normalized.frameTimeMs,
      detections,
      droppedFrame: false,
      latencyMs: Date.now() - startedAt,
    });
    return snapshot;
  }
}
