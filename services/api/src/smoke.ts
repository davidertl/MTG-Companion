import { startApiServer } from "./server";

const server = await startApiServer(0);

try {
  const response = await fetch(`${server.baseUrl}/health`);
  if (response.status !== 200) {
    throw new Error(`expected 200 from /health, got ${response.status}`);
  }
  const payload = (await response.json()) as { status?: string };
  if (payload.status !== "ok") {
    throw new Error(`unexpected health payload: ${JSON.stringify(payload)}`);
  }
  console.log(`API smoke passed at ${server.baseUrl}`);
} finally {
  await server.close();
}
