export function SummaryMetric(props: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        background: "#0d121b",
        border: "1px solid #24324a",
        borderRadius: 14,
        padding: 16,
        display: "grid",
        gap: 6,
      }}
    >
      <span style={{ color: "#8ea0bc", fontSize: 13 }}>{props.label}</span>
      <strong style={{ color: "#f7f9fc", fontSize: 22 }}>{props.value}</strong>
    </div>
  );
}
