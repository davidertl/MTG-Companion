import { PaperClientWorkbench } from "./PaperClientWorkbench";

export function PaperDesktopApp() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0f17",
        color: "#dce6f4",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
      }}
    >
      <section style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>MancuTG-PaperC (Windows webcam mode)</h1>
        <p style={{ margin: 0, color: "#8ea0bc" }}>
          Standalone operator view for Windows notebooks with attached webcams. This surface is
          intentionally separate from the Overwolf ArenaC shell and supports live backend forwarding.
        </p>
      </section>
      <PaperClientWorkbench />
    </main>
  );
}
