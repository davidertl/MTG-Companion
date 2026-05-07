import type { IngestBatchRequest } from "../../../packages/shared-schema/src/events";

export type ArenaProducerConfig = {
  backendUrl: string;
  producerToken: string | null;
  uploadRawLogs: boolean;
  uploadNormalizedEvents: boolean;
};

export const DEFAULT_ARENA_PRODUCER_CONFIG: ArenaProducerConfig = {
  backendUrl: "http://127.0.0.1:18080",
  producerToken: null,
  uploadRawLogs: false,
  uploadNormalizedEvents: true,
};

export function createArenaIngestBatch(batch: IngestBatchRequest): IngestBatchRequest {
  return batch;
}
