import {
  ingestBatchRequestSchema,
  type IngestBatchRequest,
  type IngestBatchResponse,
} from "../../../../packages/shared-schema/src/index.ts";
import { SqliteClient } from "../storage/sqlite/client.ts";

export class ImmutableBatchConflictError extends Error {}

export function ingestBatch(input: unknown, sqlite: SqliteClient): IngestBatchResponse {
  const payload = ingestBatchRequestSchema.parse(input) as IngestBatchRequest;
  try {
    return sqlite.createOrGetBatch(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "immutable-batch-conflict") {
      throw new ImmutableBatchConflictError("immutable-batch-conflict");
    }
    throw error;
  }
}
