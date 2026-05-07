export type HistoryRow = {
  matchId: string;
  deck: string;
  result: string;
  queue: string;
};

export type PapercLiveLogRow = {
  timestamp: string;
  eventType: string;
  player: string;
  card: string;
  zone: string;
  confidence: number;
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

export function exportPapercLogAsCsv(rows: PapercLiveLogRow[]): string {
  const header = "timestamp,eventType,player,card,zone,confidence";
  const body = rows.map((row) =>
    [
      row.timestamp,
      row.eventType,
      row.player,
      row.card,
      row.zone,
      row.confidence.toFixed(3),
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );
  return [header, ...body].join("\n");
}
