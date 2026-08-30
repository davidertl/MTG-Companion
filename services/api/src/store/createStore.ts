import {
  createPersistentEventStore,
  type BackendStoreLike,
} from "./jsonStore.ts";
import { createSqliteStore } from "./sqliteStore.ts";

/**
 * Selects the persistence backend from the configured store path
 * (`MANCUTG_BACKEND_STORE_PATH`):
 * - paths ending in `.json` keep the legacy JSON file store (backward
 *   compatibility — the unset default `mancutg-backend-store.json` also
 *   lands here),
 * - every other path opens a `node:sqlite` database.
 */
export function createBackendStore(storePath: string): BackendStoreLike {
  if (storePath.endsWith(".json")) {
    return createPersistentEventStore(storePath);
  }
  return createSqliteStore(storePath);
}
