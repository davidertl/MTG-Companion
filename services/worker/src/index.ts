import type { SyncObject } from "../../../packages/shared-schema/src/index";

export interface WorkerJob {
  type: "sync-dispatch" | "archidekt-refresh";
  objectId: string;
}

export function buildWorkerJobs(syncObjects: SyncObject[]): WorkerJob[] {
  return syncObjects
    .filter((item) => item.dirty)
    .map((item) => ({
      type: item.objectType === "archidekt_snapshot" ? "archidekt-refresh" : "sync-dispatch",
      objectId: item.objectId,
    }));
}
