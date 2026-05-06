import { syncObjectSchema, type SyncObject } from "../../../../packages/shared-schema/src/index";

export interface SyncStore {
  values: SyncObject[];
}

export type SyncResult = {
  accepted: SyncObject[];
  rejected: string[];
};

export function createInMemorySyncStore(): SyncStore {
  return { values: [] };
}

export function acceptSyncObjects(input: unknown[]): SyncResult {
  const accepted: SyncObject[] = [];
  const rejected: string[] = [];

  input.forEach((candidate, index) => {
    const parsed = syncObjectSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected.push(`item-${index}`);
      return;
    }

    accepted.push(parsed.data);
  });

  return { accepted, rejected };
}

export function mergeSyncState(existing: SyncObject[], updates: SyncObject[]): SyncObject[] {
  const merged = new Map(existing.map((item) => [`${item.objectType}:${item.objectId}`, item]));

  for (const update of updates) {
    merged.set(`${update.objectType}:${update.objectId}`, update);
  }

  return [...merged.values()];
}

export function applySyncObjects(store: SyncStore, input: unknown[]): SyncObject[] {
  const result = acceptSyncObjects(input);
  store.values = mergeSyncState(store.values, result.accepted);
  return result.accepted;
}
