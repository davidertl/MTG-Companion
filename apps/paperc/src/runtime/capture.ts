import { papercFrameInputSchema, type PapercFrameInput } from "./types";

export interface WebcamFrameSource {
  nextFrame(): Promise<PapercFrameInput | null>;
}

export class ScriptedWebcamFrameSource implements WebcamFrameSource {
  private index = 0;

  constructor(private readonly frames: PapercFrameInput[]) {}

  async nextFrame(): Promise<PapercFrameInput | null> {
    if (this.index >= this.frames.length) {
      return null;
    }
    const frame = this.frames[this.index];
    this.index += 1;
    return papercFrameInputSchema.parse(frame);
  }
}

export function preprocessFrame(frame: PapercFrameInput): PapercFrameInput {
  const parsed = papercFrameInputSchema.parse(frame);
  const clampedDetections = parsed.rawDetections.map((item) => ({
    ...item,
    confidence: Math.min(1, Math.max(0, item.confidence)),
  }));
  return {
    ...parsed,
    rawDetections: clampedDetections,
  };
}
