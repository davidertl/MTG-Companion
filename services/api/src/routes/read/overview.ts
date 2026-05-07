import { SqliteClient } from "../../storage/sqlite/client.ts";

export function overviewRoute(sqlite: SqliteClient): Record<string, unknown> {
  return sqlite.getOverview();
}
