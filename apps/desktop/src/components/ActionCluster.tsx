export function ActionCluster(props: {
  labels: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      {props.labels.map((label) => (
        <button
          key={label}
          type="button"
          style={{
            border: "1px solid #35507a",
            borderRadius: 999,
            background: label.includes("Start") ? "#4f8cff" : "#192334",
            color: "#f7f9fc",
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
