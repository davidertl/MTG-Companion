import type { ReactNode } from "react";

export function ShellPanel(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.title}
      style={{
        background: "#141a25",
        border: "1px solid #24324a",
        borderRadius: 16,
        padding: 20,
        display: "grid",
        gap: 12,
      }}
    >
      <header style={{ display: "grid", gap: 4 }}>
        <h2
          style={{
            margin: 0,
            color: "#f7f9fc",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {props.title}
        </h2>
        {props.subtitle ? (
          <p style={{ margin: 0, color: "#8ea0bc", fontSize: 14 }}>{props.subtitle}</p>
        ) : null}
      </header>
      {props.children}
    </section>
  );
}
