/**
 * Local persistence for the PaperC PWA (plan 2026-07-06-001 W2.2).
 *
 * A tiny synchronous key/value abstraction so the game log and the sync outbox
 * survive reloads. The default implementation targets `localStorage` (available
 * in every mobile browser); an in-memory store backs tests and SSR/build. The
 * interface is deliberately narrow so an IndexedDB-backed adapter can be dropped
 * in later without touching call sites.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

class LocalStorageStore implements KeyValueStore {
  constructor(private readonly backing: Storage) {}

  get(key: string): string | null {
    return this.backing.getItem(key);
  }

  set(key: string, value: string): void {
    this.backing.setItem(key, value);
  }

  remove(key: string): void {
    this.backing.removeItem(key);
  }
}

/**
 * Returns `localStorage` when running in a browser, otherwise an in-memory
 * store. Never throws — a locked-down browser (private mode quota errors) also
 * degrades to memory.
 */
export function getDefaultStore(): KeyValueStore {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      const storage = (globalThis as { localStorage?: Storage }).localStorage;
      if (storage) {
        // Probe once — some environments expose the object but throw on write.
        const probeKey = "__mancutg_paperc_probe__";
        storage.setItem(probeKey, "1");
        storage.removeItem(probeKey);
        return new LocalStorageStore(storage);
      }
    }
  } catch {
    /* fall through to memory */
  }
  return new MemoryStore();
}

export function loadJson<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.get(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveJson(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}

export const GAME_LOG_STORAGE_KEY = "mancutg.paperc.gameLog.v1";
export const SETUP_STORAGE_KEY = "mancutg.paperc.setup.v1";
export const OUTBOX_STORAGE_KEY = "mancutg.paperc.outbox.v1";
export const REFEREE_SESSION_STORAGE_KEY = "mancutg.paperc.referee.v1";
