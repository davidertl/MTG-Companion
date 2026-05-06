import { startApiServer } from "./server";

const port = process.env.PORT ? Number(process.env.PORT) : 8787;

startApiServer(port).then((server) => {
  console.log(`MancuTG-backend listening on http://127.0.0.1:${server.port}`);
});
