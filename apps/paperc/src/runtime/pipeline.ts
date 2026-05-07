import {
  createStickyFrameSource,
  type WebcamFrameSource,
  type WebcamFrameSourceFactory,
} from "./capture";
import { preprocessFrame } from "./capture";
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
  private liveSourceFactory: WebcamFrameSourceFactory | null = null;

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

  async runLiveTick(sourceFactory: WebcamFrameSourceFactory): Promise<PapercRecognitionSnapshot | null> {
    if (!this.liveSourceFactory) {
      this.liveSourceFactory = createStickyFrameSource(sourceFactory);
    }
    return this.runOnce(this.liveSourceFactory());
  }

  resetLiveSource(): void {
    this.liveSourceFactory = null;
  }
}
