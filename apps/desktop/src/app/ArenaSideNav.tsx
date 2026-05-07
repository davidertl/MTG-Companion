import { ARENA_ROUTES, type ArenaRouteId } from "./routes";

const baseItem = {
  textAlign: "left" as const,
  border: "none",
  background: "transparent",
  color: "#b6c5da",
  padding: "10px 12px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  width: "100%",
  display: "block",
};

export function ArenaSideNav(props: {
  active: ArenaRouteId;
  onNavigate: (id: ArenaRouteId) => void;
}) {
  const { active, onNavigate } = props;
  return (
    <aside
      style={{
        background: "#0f1520",
        border: "1px solid #24324a",
        borderRadius: 20,
        padding: 20,
        display: "grid",
        gap: 8,
        alignContent: "start",
      }}
    >
      <span
        style={{
          color: "#8ea0bc",
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "0 12px 6px",
        }}
      >
        Navigation
      </span>
      {ARENA_ROUTES.map((route) => {
        const isActive = route.id === active;
        return (
          <button
            key={route.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onNavigate(route.id)}
            style={{
              ...baseItem,
              color: isActive ? "#f7f9fc" : "#b6c5da",
              background: isActive ? "#182336" : "transparent",
              fontWeight: isActive ? 700 : 500,
            }}
          >
            {route.label}
          </button>
        );
      })}
    </aside>
  );
}
