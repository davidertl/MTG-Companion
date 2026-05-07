import { useEffect, useMemo, useState } from "react";

export interface DashboardData {
  activeProducers: number;
  activeSessions: number;
  eventsLast5Minutes: number;
  errorsLast5Minutes: number;
  reviewQueueCount: number;
}

export function formatDashboardCards(data: DashboardData): Array<{ label: string; value: number }> {
  return [
    { label: "Active Producers", value: data.activeProducers },
    { label: "Active Sessions", value: data.activeSessions },
    { label: "Events (5m)", value: data.eventsLast5Minutes },
    { label: "Errors (5m)", value: data.errorsLast5Minutes },
    { label: "Review Queue", value: data.reviewQueueCount },
  ];
}

export function DashboardPage(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/v1/overview")
      .then((response) => response.json())
      .then((json) => setData(json))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    const source = new EventSource("/v1/live");
    source.onmessage = () => {
      fetch("/v1/overview")
        .then((response) => response.json())
        .then((json) => setData(json))
        .catch(() => {});
    };
    return () => source.close();
  }, []);

  const cards = useMemo(() => (data ? formatDashboardCards(data) : []), [data]);
  if (error) {
    return <p>Dashboard failed: {error}</p>;
  }
  if (!data) {
    return <p>Loading dashboard...</p>;
  }

  return (
    <section>
      <h2>Dashboard</h2>
      <div>
        {cards.map((card) => (
          <article key={card.label}>
            <h3>{card.label}</h3>
            <p>{card.value}</p>
          </article>
        ))}
      </div>
      <p>Producer status cards: ArenaC, PaperC, Backend.</p>
    </section>
  );
}
