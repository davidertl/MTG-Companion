import { describe, expect, it, vi } from "vitest";

import { saveBackupBundle } from "../src/lib/export/index";

describe("saveBackupBundle", () => {
  const bundle = {
    sessions: [{ sessionId: "session-1" }],
    matchHistory: [
      { matchId: "m-1", deck: "Azorius", result: "win", queue: "ranked" },
    ],
  };

  it("serializes the bundle and writes to the path chosen via the save dialog", async () => {
    const pickPath = vi.fn().mockResolvedValue("/tmp/backup.json");
    const writeFile = vi.fn().mockResolvedValue("/tmp/backup.json");

    const result = await saveBackupBundle(bundle, { pickPath, writeFile });

    expect(pickPath).toHaveBeenCalledWith("mancutg-arenac-backup.json");
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContents] = writeFile.mock.calls[0];
    expect(writtenPath).toBe("/tmp/backup.json");
    expect(JSON.parse(writtenContents)).toEqual(bundle);
    expect(result).toBe("/tmp/backup.json");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const pickPath = vi.fn().mockResolvedValue(null);
    const writeFile = vi.fn();

    const result = await saveBackupBundle(bundle, { pickPath, writeFile });

    expect(result).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
