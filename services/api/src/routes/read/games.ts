import { SqliteClient } from "../../storage/sqlite/client.ts";

export function gamesRoute(sqlite: SqliteClient): Array<Record<string, unknown>> {
  return sqlite.listGames();
}
