import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Step3() {
  const router = useRouter();
  const [dragging, setDragging] = useState("");
  const [cost, setCost] = useState("");
  const [focus, setFocus] = useState("");

  useEffect(() => {
    setDragging(((router.query.dragging as string) || "").trim());
    setCost(((router.query.cost as string) || "").trim());
  }, [router.query.dragging, router.query.cost]);

  const next = () => {
    if (!focus.trim()) return;
    router.push({ pathname: "/today", query: { dragging, cost, focus } });
  };

  const summary = dragging && cost
    ? `You’re dealing with “${dragging},” and it’s costing you ${cost}.`
    : "";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 780, margin: "0 auto" }}>
      <h1>Today’s Future Me</h1>

      <p style={{ margin: "14px 0" }}>{summary}</p>
      <p style={{ margin: "12px 0" }}><strong>Keep this as today’s focus?</strong></p>

      <textarea
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #d1d5db" }}
        placeholder="Write your one-sentence focus…"
      />

      <div style={{ marginTop: 12, textAlign: "right" }}>
        <button onClick={next} style={{ padding: "10px 14px", borderRadius: 999, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
          Generate CSC →
        </button>
      </div>
    </main>
  );
}
