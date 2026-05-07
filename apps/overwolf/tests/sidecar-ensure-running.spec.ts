import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ensureArenaServiceRunning } from "../src/setup-window";

describe("ensureArenaServiceRunning", () => {
  it("returns started when service is already healthy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureArenaServiceRunning("http://127.0.0.1:17890");
    expect(result.started).toBe(true);
    expect(result.usedManualFallback).toBe(false);
  });

  it("returns manual fallback when plugin is unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as unknown as { processManager?: unknown }).processManager = undefined;

    const result = await ensureArenaServiceRunning("http://127.0.0.1:17890");
    expect(result.started).toBe(false);
    expect(result.usedManualFallback).toBe(true);
    expect(result.reason).toContain("plugin unavailable");
  });

  it("returns launch failure for plugin errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as unknown as { processManager?: unknown }).processManager = {
      launchProcess: vi.fn().mockRejectedValue(new Error("spawn failed")),
    };

    const result = await ensureArenaServiceRunning("http://127.0.0.1:17890");
    expect(result.started).toBe(false);
    expect(result.usedManualFallback).toBe(true);
    expect(result.reason).toContain("spawn failed");
  });

  it("package script stages sidecar and plugins", () => {
    const scriptPath = path.resolve("scripts/package-overwolf.ps1");
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain('Join-Path $Stage "bin"');
    expect(script).toContain('Join-Path $Stage "plugins"');
    expect(script).toContain("mancutg-arenac.exe");
  });
});
