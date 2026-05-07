import { useEffect, useState } from "react";

export function ReviewQueuePage(): JSX.Element {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);

  const load = () =>
    fetch("/v1/review-queue")
      .then((response) => response.json())
      .then(setItems);

  useEffect(() => {
    void load();
  }, []);

  const resolve = async (eventId: string, resolution: "accept" | "discard") => {
    await fetch(`/v1/review-queue/${encodeURIComponent(eventId)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    await load();
  };

  return (
    <section>
      <h2>Review Queue</h2>
      <ul>
        {items.map((item) => (
          <li key={String(item.id)}>
            {String(item.event_type)} - {String(item.id)}
            <button onClick={() => void resolve(String(item.id), "accept")}>Accept</button>
            <button onClick={() => void resolve(String(item.id), "discard")}>Discard</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
