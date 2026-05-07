import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

import { DashboardPage } from "./pages/DashboardPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionsPage } from "./pages/SessionsPage";

type Page = "dashboard" | "sessions" | "session-detail" | "review-queue" | "diagnostics";

function parsePage(): Page {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("session:")) {
    return "session-detail";
  }
  if (hash === "sessions") {
    return "sessions";
  }
  if (hash === "review-queue") {
    return "review-queue";
  }
  if (hash === "diagnostics") {
    return "diagnostics";
  }
  return "dashboard";
}

function App(): JSX.Element {
  const [page, setPage] = useState<Page>(parsePage);
  useEffect(() => {
    const onHash = () => setPage(parsePage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <main>
      <h1>MancuTG Backend UI</h1>
      <nav>
        <a href="#">Dashboard</a> | <a href="#sessions">Sessions</a> |{" "}
        <a href="#review-queue">Review Queue</a> | <a href="#diagnostics">Diagnostics</a>
      </nav>
      {page === "dashboard" && <DashboardPage />}
      {page === "sessions" && <SessionsPage />}
      {page === "session-detail" && <SessionDetailPage />}
      {page === "review-queue" && <ReviewQueuePage />}
      {page === "diagnostics" && <DiagnosticsPage />}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root");
}
createRoot(root).render(<App />);
