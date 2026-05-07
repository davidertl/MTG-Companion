/**
 * Smoke-test `mancutg-arenac serve` HTTP API (used by Overwolf / React client).
 * Requires `cargo` on PATH and repo root as CWD.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mancutg-arenac-smoke-"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readHandshakeBaseUrl() {
  const handshakePath = path.join(dataDir, "mancutg-arenac-service.json");
  if (!fs.existsSync(handshakePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(handshakePath, "utf8"));
    return typeof raw.baseUrl === "string" ? raw.baseUrl : null;
  } catch {
    return null;
  }
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    const fromFile = await readHandshakeBaseUrl();
    if (fromFile) {
      const base = fromFile.replace(/\/$/, "");
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) {
          return base;
        }
      } catch {
        /* keep waiting */
      }
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for mancutg-arenac serve health check");
}

const proc = spawn(
  "cargo",
  ["run", "-p", "mancutg-arenac", "--", "serve", "--data-dir", dataDir, "--port", "0"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  },
);

let stderr = "";
proc.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

const baseUrl = await waitForServer();

async function mustOk(label, res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }
}

const h = await fetch(`${baseUrl}/health`);
await mustOk("GET /health", h);

const st = await fetch(`${baseUrl}/v1/status`);
await mustOk("GET /v1/status", st);

const det = await fetch(`${baseUrl}/v1/detect-player-log`);
await mustOk("GET /v1/detect-player-log", det);

const logPath = path.join(dataDir, "smoke.log");
fs.writeFileSync(
  logPath,
  "2026-05-07T04:00:00Z|MATCH_START|match_id=smoke|deck=Test|queue=ranked\n",
);

const wt = await fetch(`${baseUrl}/v1/watch/tick`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ logPath }),
});
await mustOk("POST /v1/watch/tick", wt);

const store = await fetch(`${baseUrl}/v1/store`);
await mustOk("GET /v1/store", store);

const lt = await fetch(`${baseUrl}/v1/import/log-text`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fileName: "upload.log",
    content: "2026-05-07T04:00:00Z|MATCH_START|match_id=u2|deck=Z|queue=ranked\n",
  }),
});
await mustOk("POST /v1/import/log-text", lt);

try {
  proc.kill("SIGTERM");
} catch {
  /* ignore */
}
if (process.platform === "win32" && proc.pid) {
  spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
}
await sleep(500);
fs.rmSync(dataDir, { recursive: true, force: true });

console.log("overwolf_smoke: OK (mancutg-arenac serve endpoints)");
