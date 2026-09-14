export default function ListPending({ label }: { label: string }) {
  return <div role="status" aria-live="polite" style={{ minHeight: "24rem", padding: "1.5rem", color: "var(--text-muted)" }}>{label}</div>;
}
