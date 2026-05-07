import { useEffect, useState } from "react";

export function SessionDetailPage(): JSX.Element {
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const sessionId = window.location.hash.split(":")[1] ?? "";

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    void fetch(`/v1/sessions/${encodeURIComponent(sessionId)}`)
      .then((response) => response.json())
      .then(setSession);
    void fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/events`)
      .then((response) => response.json())
      .then(setEvents);
  }, [sessionId]);

  return (
    <section>
      <h2>Session Detail</h2>
      <pre>{JSON.stringify(session, null, 2)}</pre>
      <h3>Timeline and Events</h3>
      <pre>{JSON.stringify(events, null, 2)}</pre>
    </section>
  );
}
