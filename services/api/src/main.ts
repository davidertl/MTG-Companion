import { join } from "node:path";

import { createPersistentEventStore } from "./domain/eventService";
import { startApiServer } from "./server";

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
const eventStorePath =
  process.env.MANCUTG_BACKEND_STORE_PATH ??
  join(process.cwd(), "mancutg-backend-store.json");

startApiServer(port, {
  eventStore: createPersistentEventStore(eventStorePath),
}).then((server) => {
  console.log(
    `MancuTG-backend listening on http://127.0.0.1:${server.port} (event store: ${eventStorePath})`,
  );
});
