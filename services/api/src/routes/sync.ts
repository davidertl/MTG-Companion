import { syncObjectSchema, type SyncObject } from "../../../../packages/shared-schema/src/index";
import { resolveSessionMode } from "../auth/optionalMode";
import { applySyncObjects, type SyncStore } from "../domain/syncService";

export interface SyncRouteResult {
  sessionMode: "anonymous" | "authenticated";
  accepted: SyncObject[];
}

export function syncRoute(input: unknown, token: string | undefined, store: SyncStore): SyncRouteResult {
  const payload = syncObjectSchema.array().parse(input);
  const sessionMode = resolveSessionMode(token);
  const accepted = applySyncObjects(store, payload);

  return {
    sessionMode,
    accepted,
  };
}
