import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  archidektDeckSnapshotSchema,
  type ArchidektDeckSnapshot,
} from "../../../../../../packages/shared-schema/src/archidekt.ts";

export type ArchidektFetcher = (deckId: string) => Promise<unknown>;
const execFileAsync = promisify(execFile);

type CachedDeck = {
  snapshot: ArchidektDeckSnapshot;
  expiresAt: number;
};

export class ArchidektImportRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ArchidektImportRouteOptions {
  cacheTtlMs?: number;
  now?: () => number;
}

export function buildArchidektImportRoute(
  fetchSnapshot: ArchidektFetcher,
  options: ArchidektImportRouteOptions = {},
) {
  const cache = new Map<string, CachedDeck>();
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;

  return async function importDeck(deckId: string): Promise<ArchidektDeckSnapshot> {
    const cached = cache.get(deckId);
    if (cached && cached.expiresAt > now()) {
      return cached.snapshot;
    }

    let rawSnapshot: unknown;
    try {
      rawSnapshot = await fetchSnapshot(deckId);
    } catch (error) {
      throw mapArchidektError(error);
    }
    const parsed = archidektDeckSnapshotSchema.parse(rawSnapshot);
    if (parsed.deckId !== deckId) {
      throw new ArchidektImportRouteError(
        502,
        "archidekt-connector-mismatch",
        `connector returned deckId ${parsed.deckId} for requested deck ${deckId}`,
      );
    }

    cache.set(deckId, {
      snapshot: parsed,
      expiresAt: now() + cacheTtlMs,
    });
    return parsed;
  };
}

export interface RuntimeArchidektFetcherOptions {
  pythonExecutable?: string;
  connectorScriptPath?: string;
  timeoutMs?: number;
}

export function buildRuntimeArchidektFetcher(
  options: RuntimeArchidektFetcherOptions = {},
): ArchidektFetcher {
  const pythonExecutable = options.pythonExecutable ?? process.env.ARCHIDEKT_CONNECTOR_PYTHON ?? "python3";
  const connectorScriptPath =
    options.connectorScriptPath ??
    process.env.ARCHIDEKT_CONNECTOR_SCRIPT ??
    join(process.cwd(), "services/archidekt-connector/src/connector.py");
  const timeoutMs = options.timeoutMs ?? 15000;

  return async function runtimeFetch(deckId: string): Promise<unknown> {
    try {
      const { stdout } = await execFileAsync(
        pythonExecutable,
        [connectorScriptPath, "--deck-id", deckId],
        { timeout: timeoutMs },
      );
      return JSON.parse(stdout);
    } catch (error) {
      throw mapArchidektError(error);
    }
  };
}

function mapArchidektError(error: unknown): ArchidektImportRouteError {
  const message =
    error instanceof Error ? error.message : "unknown archidekt import error";
  const lower = message.toLowerCase();

  if (lower.includes("not found") || lower.includes("404")) {
    return new ArchidektImportRouteError(404, "archidekt-deck-not-found", message);
  }

  if (lower.includes("rate limit") || lower.includes("429")) {
    return new ArchidektImportRouteError(429, "archidekt-rate-limited", message);
  }

  return new ArchidektImportRouteError(502, "archidekt-fetch-failed", message);
}
