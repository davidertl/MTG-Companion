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
