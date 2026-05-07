import { join } from "node:path";

import { createPersistentEventStore } from "./domain/eventService.ts";
import { createLiveHub } from "./routes/read/live.ts";
import { startApiServer } from "./server.ts";
import { SqliteClient } from "./storage/sqlite/client.ts";

const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const eventStorePath =
  process.env.MANCUTG_BACKEND_STORE_PATH ??
  join(process.cwd(), "mancutg-backend-store.json");
const sqlitePath =
  process.env.MANCUTG_BACKEND_SQLITE_PATH ??
  join(process.cwd(), "mancutg-backend-store.sqlite3");
const sqliteSchemaPath =
  process.env.MANCUTG_BACKEND_SQLITE_SCHEMA_PATH ??
  join(process.cwd(), "services/api/src/storage/sqlite/schema.sql");

const sqlite = new SqliteClient({
  dbPath: sqlitePath,
  schemaPath: sqliteSchemaPath,
});

startApiServer(port, {
  eventStore: createPersistentEventStore(eventStorePath),
  sqlite,
  liveHub: createLiveHub(),
}).then((server) => {
  console.log(
    `MancuTG-backend listening on http://127.0.0.1:${server.port} (event store: ${eventStorePath}, sqlite: ${sqlitePath})`,
  );
});
