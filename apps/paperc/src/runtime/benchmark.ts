import type { PapercFrameInput, PapercRuntimeConfig } from "./types";
import { CardIdentifierEngine } from "./recognizer";

export interface IdentifierBenchmarkSample {
  frame: PapercFrameInput;
  expectedCardNames: string[];
}

export interface IdentifierBenchmarkResult {
  totalExpected: number;
  totalDetected: number;
  exactMatchFrames: number;
  frameCount: number;
  recall: number;
}

export function benchmarkIdentifier(
  config: PapercRuntimeConfig,
  cardPool: string[],
  samples: IdentifierBenchmarkSample[],
): IdentifierBenchmarkResult {
  const engine = new CardIdentifierEngine(config, cardPool);
  let totalExpected = 0;
  let totalDetected = 0;
  let exactMatchFrames = 0;

  for (const sample of samples) {
    const detections = engine.identify(sample.frame);
    const detectedNames = detections.map((item) => item.candidateName).sort();
    const expected = [...sample.expectedCardNames].sort();
    totalExpected += expected.length;
    totalDetected += detectedNames.filter((name) => expected.includes(name)).length;
    if (expected.join("|") === detectedNames.join("|")) {
      exactMatchFrames += 1;
    }
  }

  return {
    totalExpected,
    totalDetected,
    exactMatchFrames,
    frameCount: samples.length,
    recall: totalExpected === 0 ? 1 : totalDetected / totalExpected,
  };
}
