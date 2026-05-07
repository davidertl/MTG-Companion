import type { PapercFrameDetection } from "../../../../packages/shared-schema/src/index";
import {
  papercRuntimeConfigSchema,
  type PapercFrameInput,
  type PapercRuntimeConfig,
} from "./types";

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(label: string): string {
  return label
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export class CardIdentifierEngine {
  private readonly knownCards: Map<string, string>;
  private readonly config: PapercRuntimeConfig;

  constructor(config: PapercRuntimeConfig, cardPool: string[]) {
    this.config = papercRuntimeConfigSchema.parse(config);
    this.knownCards = new Map(
      cardPool.map((cardName) => [normalizeLabel(cardName), titleCase(cardName)]),
    );
  }

  identify(frame: PapercFrameInput): PapercFrameDetection[] {
    return frame.rawDetections
      .map((detection, index) => {
        const normalized = normalizeLabel(detection.label);
        const resolvedName = this.knownCards.get(normalized);
        if (!resolvedName) {
          return null;
        }
        return {
          detectionId: `${this.config.captureSessionId}-f${frame.frameNo}-d${index}`,
          frameNo: frame.frameNo,
          frameTimeMs: frame.frameTimeMs,
          zoneId: detection.zoneId,
          candidateName: resolvedName,
          confidence: detection.confidence,
          cardCount: detection.count,
        };
      })
      .filter((item): item is PapercFrameDetection => item !== null);
  }
}
