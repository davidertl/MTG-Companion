import { useState } from "react";
import { searchCardNames } from "../state/cardIndex";
import { theme } from "./components";

/**
 * Card-name entry with offline fuzzy autocomplete against the bundled index.
 */
export function CardNameInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onCommit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = open ? searchCardNames(props.value, 6) : [];

  return (
    <div style={{ position: "relative", display: "grid", gap: 4 }}>
      <input
        value={props.value}
        placeholder={props.placeholder ?? "Card name…"}
        aria-label="Card name"
        onChange={(event) => {
          props.onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            setOpen(false);
            props.onCommit?.();
          }
        }}
        style={{
          background: "#0e1521",
          border: `1px solid ${theme.panelBorder}`,
          borderRadius: 10,
          color: theme.text,
          padding: "9px 11px",
          fontSize: 14,
        }}
      />
      {suggestions.length > 0 ? (
        <ul
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            margin: 0,
            marginTop: 4,
            padding: 4,
            listStyle: "none",
            background: theme.panel,
            border: `1px solid ${theme.panelBorder}`,
            borderRadius: 10,
            zIndex: 50,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onChange(name);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  color: theme.text,
                  padding: "7px 9px",
                  fontSize: 14,
                  cursor: "pointer",
                  borderRadius: 8,
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
