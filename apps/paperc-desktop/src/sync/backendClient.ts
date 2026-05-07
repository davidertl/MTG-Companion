import {
  ingestBatchRequestSchema,
  ingestBatchResponseSchema,
  type IngestBatchRequest,
  type IngestBatchResponse,
} from "../../../../packages/shared-schema/src/index";

export class BackendSyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly bodyText?: string,
  ) {
    super(message);
  }
}

export async function postIngestBatch(
  endpoint: string,
  batch: IngestBatchRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestBatchResponse> {
  const payload = ingestBatchRequestSchema.parse(batch);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new BackendSyncError(
      `Backend rejected PaperC batch: ${response.status}${bodyText ? ` ${bodyText}` : ""}`,
      response.status,
      bodyText,
    );
  }

  const data = await response.json();
  return ingestBatchResponseSchema.parse(data);
}
