import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Step2() {
  const router = useRouter();
  const [dragging, setDragging] = useState("");
  const [cost, setCost] = useState("");

  useEffect(() => {
    const d = (router.query.dragging as string) || "";
    setDragging(d);
  }, [router.query.dragging]);

  const next = () => {
    if (!cost.trim()) return;
    router.push({ pathname: "/entries/step3", query: { dragging, cost } });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 780, margin: "0 auto" }}>
      <h1>Today’s Future Me</h1>

      <p style={{ margin: "14px 0" }}>
        You said: <em>{dragging || "—"}</em>
      </p>

      <p style={{ margin: "12px 0" }}>
        <strong>What is this costing you today (time, peace, confidence)?</strong>
      </p>

      <textarea
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #d1d5db" }}
        placeholder="Short and real… e.g., ‘Losing focus and sleep.’"
      />

      <div style={{ marginTop: 12, textAlign: "right" }}>
        <button onClick={next} style={{ padding: "10px 14px", borderRadius: 999, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
          Next →
        </button>
      </div>
    </main>
  );
}
