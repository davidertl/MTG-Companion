export type JsonlStorage = {
  read(sessionId: string): Promise<string[]>;
  append(sessionId: string, line: string): Promise<void>;
};

export type JsonlEvent = Record<string, unknown>;

const JSONL_KEY_PREFIX = "paperc-jsonl:";

export function serializeJsonlEvent(event: JsonlEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export class LocalStorageJsonlStorage implements JsonlStorage {
  async read(sessionId: string): Promise<string[]> {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(`${JSONL_KEY_PREFIX}${sessionId}`);
    if (!raw) {
      return [];
    }
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `${line}\n`);
  }

  async append(sessionId: string, line: string): Promise<void> {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const key = `${JSONL_KEY_PREFIX}${sessionId}`;
    const current = window.localStorage.getItem(key) ?? "";
    window.localStorage.setItem(key, `${current}${line}`);
  }
}

export class JsonlLogWriter {
  constructor(private readonly storage: JsonlStorage) {}

  appendEvent(sessionId: string, event: JsonlEvent): Promise<void> {
    return this.storage.append(sessionId, serializeJsonlEvent(event));
  }

  readSession(sessionId: string): Promise<string[]> {
    return this.storage.read(sessionId);
  }
}
