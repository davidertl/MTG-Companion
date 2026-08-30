import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  tauriSetConsent,
  tauriInspectMatch,
  tauriWriteExportFile,
  tauriStartWatcher,
  tauriStopWatcher,
  tauriSyncNow,
} from "../src/lib/tauri/commands";

afterEach(() => {
  invoke.mockReset();
});

describe("tauri command wrappers", () => {
  it("set_consent forwards the purpose and enabled flag", async () => {
    invoke.mockResolvedValue({ privacy: {} });
    await tauriSetConsent("telemetry", true);
    expect(invoke).toHaveBeenCalledWith("set_consent", {
      purpose: "telemetry",
      enabled: true,
    });
  });

  it("inspect_match forwards the matchId", async () => {
    invoke.mockResolvedValue({ matchId: "m1", events: [] });
    await tauriInspectMatch("m1");
    expect(invoke).toHaveBeenCalledWith("inspect_match", { matchId: "m1" });
  });

  it("write_export_file forwards the path and contents", async () => {
    invoke.mockResolvedValue("/tmp/backup.json");
    await tauriWriteExportFile("/tmp/backup.json", "{}");
    expect(invoke).toHaveBeenCalledWith("write_export_file", {
      path: "/tmp/backup.json",
      contents: "{}",
    });
  });

  it("keeps the W1.2 watcher wrappers wired to their commands", async () => {
    invoke.mockResolvedValue({ running: true });
    await tauriStartWatcher("/tmp/Player.log");
    expect(invoke).toHaveBeenCalledWith("start_watcher", {
      logPath: "/tmp/Player.log",
    });

    invoke.mockResolvedValue({ running: false });
    await tauriStopWatcher();
    expect(invoke).toHaveBeenCalledWith("stop_watcher");
  });

  it("sync_now invokes the sync command with no arguments", async () => {
    invoke.mockResolvedValue({
      syncEnabled: true,
      attempted: true,
      batchesSent: 1,
      eventsSynced: 3,
      pendingRemaining: 0,
      backendUrl: "http://127.0.0.1:8787/events",
      lastError: null,
    });
    const outcome = await tauriSyncNow();
    expect(invoke).toHaveBeenCalledWith("sync_now");
    expect(outcome.eventsSynced).toBe(3);
  });
});
