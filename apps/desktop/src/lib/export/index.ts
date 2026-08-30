export type HistoryRow = {
  matchId: string;
  deck: string;
  result: string;
  queue: string;
};

export function exportHistoryAsJson(rows: HistoryRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export function exportHistoryAsCsv(rows: HistoryRow[]): string {
  const header = "matchId,deck,result,queue";
  const body = rows.map((row) =>
    [row.matchId, row.deck, row.result, row.queue]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );

  return [header, ...body].join("\n");
}

export function exportBackupBundleAsJson(bundle: unknown): string {
  return JSON.stringify(bundle, null, 2);
}

export type SaveBackupBundleDeps = {
  /** Native save dialog (e.g. `@tauri-apps/plugin-dialog` `save`). */
  pickPath: (defaultName: string) => Promise<string | null>;
  /** Writes serialized contents to the chosen path. */
  writeFile: (path: string, contents: string) => Promise<unknown>;
};

/**
 * Serializes the backup bundle via {@link exportBackupBundleAsJson} and writes
 * it to a user-chosen path. Returns the written path, or `null` if the user
 * cancelled the save dialog. Purely offline: only a local file is written.
 *
 * The file-system side effects are injected so this is unit-testable with a
 * mocked dialog and writer.
 */
export async function saveBackupBundle(
  bundle: unknown,
  deps: SaveBackupBundleDeps,
): Promise<string | null> {
  const path = await deps.pickPath("mancutg-arenac-backup.json");
  if (!path) {
    return null;
  }
  const contents = exportBackupBundleAsJson(bundle);
  await deps.writeFile(path, contents);
  return path;
}
