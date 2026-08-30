/**
 * Offline-first sync outbox for the PaperC PWA (plan 2026-07-06-001 W2.2).
 *
 * Logged actions are batched into the shared `/events` envelope and queued
 * locally. `flush()` POSTs due batches to the backend; failures stay queued and
 * retry with exponential backoff. Every batch carries a stable `idempotencyKey`
 * (also sent as the `Idempotency-Key` header) so a retry after a lost ack never
 * creates duplicate server rows, and re-enqueuing the same key is a no-op.
 *
 * The outbox never fetches on its own — it only acts when `flush()` is called,
 * so the client is fully usable with no backend (offline-first invariant).
 */

import type { BackendEventBatchEnvelope } from "../../../../packages/shared-schema/src/index";
import {
  getDefaultStore,
  loadJson,
  saveJson,
  OUTBOX_STORAGE_KEY,
  type KeyValueStore,
} from "../state/persistence";

export type FetchResult = { ok: boolean; status: number };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResult>;

export type OutboxEntryStatus = "pending" | "sent";

export type OutboxEntry = {
  idempotencyKey: string;
  batch: BackendEventBatchEnvelope;
  status: OutboxEntryStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type FlushSummary = {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
};

export type OutboxOptions = {
  endpoint: string;
  fetchFn: FetchLike;
  now?: () => number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
  store?: KeyValueStore;
  storageKey?: string;
};

const DEFAULT_BASE_BACKOFF_MS = 2_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;

export class Outbox {
  private readonly endpoint: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxAttempts: number;
  private readonly store: KeyValueStore;
  private readonly storageKey: string;
  private entries: OutboxEntry[];

  constructor(options: OutboxOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn;
    this.now = options.now ?? (() => Date.now());
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.store = options.store ?? getDefaultStore();
    this.storageKey = options.storageKey ?? OUTBOX_STORAGE_KEY;
    this.entries = loadJson<OutboxEntry[]>(this.store, this.storageKey) ?? [];
  }

  private persist(): void {
    saveJson(this.store, this.storageKey, this.entries);
  }

  private backoffFor(attempts: number): number {
    const raw = this.baseBackoffMs * 2 ** Math.max(0, attempts - 1);
    return Math.min(raw, this.maxBackoffMs);
  }

  /** Snapshot of all queued entries (pending + sent, for inspection/tests). */
  all(): OutboxEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  pending(): OutboxEntry[] {
    return this.entries.filter((entry) => entry.status === "pending");
  }

  pendingCount(): number {
    return this.entries.filter((entry) => entry.status === "pending").length;
  }

  private has(idempotencyKey: string): boolean {
    return this.entries.some((entry) => entry.idempotencyKey === idempotencyKey);
  }

  /**
   * Queues a batch for delivery. The batch MUST carry an `idempotencyKey`.
   * Re-enqueuing a key already known to the outbox (pending or sent) is a no-op
   * — client-side dedup complementing the server's idempotency handling.
   */
  enqueue(batch: BackendEventBatchEnvelope): boolean {
    const idempotencyKey = batch.idempotencyKey;
    if (!idempotencyKey) {
      throw new Error("outbox batches require an idempotencyKey");
    }
    if (this.has(idempotencyKey)) {
      return false;
    }
    this.entries.push({
      idempotencyKey,
      batch,
      status: "pending",
      attempts: 0,
      nextAttemptAt: this.now(),
    });
    this.persist();
    return true;
  }

  /** Attempts delivery of every pending batch that is due (`nextAttemptAt <= now`). */
  async flush(): Promise<FlushSummary> {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const entry of this.entries) {
      if (entry.status !== "pending") {
        continue;
      }
      if (entry.nextAttemptAt > this.now()) {
        skipped += 1;
        continue;
      }
      try {
        const result = await this.fetchFn(`${this.endpoint}/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": entry.idempotencyKey,
          },
          body: JSON.stringify(entry.batch),
        });
        if (result.ok) {
          entry.status = "sent";
          entry.lastError = undefined;
          sent += 1;
        } else {
          entry.attempts += 1;
          entry.lastError = `http ${result.status}`;
          entry.nextAttemptAt = this.now() + this.backoffFor(entry.attempts);
          failed += 1;
        }
      } catch (error) {
        entry.attempts += 1;
        entry.lastError = error instanceof Error ? error.message : String(error);
        entry.nextAttemptAt = this.now() + this.backoffFor(entry.attempts);
        failed += 1;
      }
    }

    this.persist();
    return { sent, failed, skipped, remaining: this.pendingCount() };
  }

  /** Drops delivered entries; their keys are no longer needed for dedup. */
  pruneSent(): void {
    this.entries = this.entries.filter((entry) => entry.status !== "sent");
    this.persist();
  }
}

/** Adapter turning the browser `fetch` into the injectable {@link FetchLike}. */
export const browserFetch: FetchLike = (url, init) =>
  fetch(url, init).then((response) => ({
    ok: response.ok,
    status: response.status,
  }));
