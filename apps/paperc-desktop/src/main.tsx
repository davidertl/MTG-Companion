import React from "react";
import { createRoot } from "react-dom/client";
import { PaperCApp } from "./PaperCApp";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("PaperC root container not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <PaperCApp />
  </React.StrictMode>,
);
