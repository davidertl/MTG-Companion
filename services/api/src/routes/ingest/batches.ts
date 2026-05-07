import { ImmutableBatchConflictError, ingestBatch } from "../../domain/ingestService.ts";
import { SqliteClient } from "../../storage/sqlite/client.ts";

export interface IngestRouteResult {
  status: number;
  payload: Record<string, unknown>;
}

export function ingestBatchesRoute(input: unknown, sqlite: SqliteClient): IngestRouteResult {
  try {
    const result = ingestBatch(input, sqlite);
    return {
      status: 200,
      payload: result as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof ImmutableBatchConflictError) {
      return {
        status: 409,
        payload: {
          error: "immutable-batch-conflict",
        },
      };
    }
    throw error;
  }
}
