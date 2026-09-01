// S18 P2: minimal observability dashboard — last-state table from /api/ops/metrics.
"use client";
import { useEffect, useState, type CSSProperties } from "react";

export default function ObservabilityPage() {
  const [rows, setRows] = useState<{ t: string; healthz: string; consec_fails: number; rpo_min: number }[]>([]);
  useEffect(() => {
    fetch("/api/ops/metrics?n=30").then((r) => r.json()).then((d) => setRows(d.series ?? [])).catch(() => {});
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>SLO observability</h1>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>time</th><th style={th}>healthz</th><th style={th}>fails</th><th style={th}>rpo_min</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={td}>{r.t}</td><td style={td}>{r.healthz}</td>
              <td style={td}>{r.consec_fails}</td><td style={td}>{r.rpo_min}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
const th: CSSProperties = { border: "1px solid #888", padding: "4px 10px", textAlign: "left" };
const td: CSSProperties = { border: "1px solid #888", padding: "4px 10px" };
