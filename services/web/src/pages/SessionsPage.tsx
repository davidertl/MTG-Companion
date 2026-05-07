import { useEffect, useState } from "react";

export function SessionsPage(): JSX.Element {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void fetch("/v1/sessions").then((response) => response.json()).then(setRows);
  }, []);

  return (
    <section>
      <h2>Sessions</h2>
      <p>Filters: game, producer, mode, status, date range.</p>
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Game</th>
            <th>Mode</th>
            <th>Producer</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>{String(row.started_at ?? "")}</td>
              <td>{String(row.game_key ?? "")}</td>
              <td>{String(row.mode ?? "")}</td>
              <td>{String(row.producer_id ?? "")}</td>
              <td>{String(row.status ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
