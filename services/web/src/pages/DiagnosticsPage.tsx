import { useEffect, useState } from "react";

export function DiagnosticsPage(): JSX.Element {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void fetch("/health").then((response) => response.json()).then(setHealth);
    void fetch("/v1/overview")
      .then((response) => response.json())
      .then((overview) => setDiagnostics({ overview, cors: "allowlist", auth: "optional" }));
  }, []);

  return (
    <section>
      <h2>Diagnostics</h2>
      <pre>{JSON.stringify(health, null, 2)}</pre>
      <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
    </section>
  );
}
