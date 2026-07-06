import type { CSSProperties, ReactNode } from "react";

/**
 * UI primitives for the PaperC PWA. Copies the desktop ShellPanel/ActionCluster
 * visual idioms (dark, rounded panels; pill buttons) without importing across
 * app boundaries — component ownership stays separate per the plan.
 */

export const theme = {
  bg: "#0a0f17",
  panel: "#141a25",
  panelBorder: "#24324a",
  accent: "#4f8cff",
  text: "#f7f9fc",
  textDim: "#8ea0bc",
  danger: "#ff8080",
  dangerBg: "#3a1a1a",
  dangerBorder: "#7a2020",
};

export function Panel(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.title}
      style={{
        background: theme.panel,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 16,
        padding: 18,
        display: "grid",
        gap: 12,
      }}
    >
      <header style={{ display: "grid", gap: 4 }}>
        <h2 style={{ margin: 0, color: theme.text, fontSize: 18, fontWeight: 700 }}>
          {props.title}
        </h2>
        {props.subtitle ? (
          <p style={{ margin: 0, color: theme.textDim, fontSize: 13 }}>
            {props.subtitle}
          </p>
        ) : null}
      </header>
      {props.children}
    </section>
  );
}

export function PillButton(props: {
  label: string;
  onClick?: () => void;
  variant?: "default" | "accent" | "danger";
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const variant = props.variant ?? "default";
  const background =
    variant === "accent"
      ? theme.accent
      : variant === "danger"
        ? theme.dangerBg
        : "#192334";
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: `1px solid ${variant === "danger" ? theme.dangerBorder : "#35507a"}`,
        borderRadius: 999,
        background,
        color: variant === "danger" ? theme.danger : theme.text,
        padding: "10px 14px",
        fontSize: 14,
        fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        ...props.style,
      }}
    >
      {props.label}
    </button>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4, color: theme.textDim, fontSize: 13 }}>
      <span>{props.label}</span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        style={{
          background: "#0e1521",
          border: `1px solid ${theme.panelBorder}`,
          borderRadius: 10,
          color: theme.text,
          padding: "9px 11px",
          fontSize: 14,
        }}
      />
    </label>
  );
}
