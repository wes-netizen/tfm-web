import { useRouter } from "next/router";
import { useState } from "react";

export default function Step1() {
  const router = useRouter();
  const [dragging, setDragging] = useState("");

  const next = () => {
    if (!dragging.trim()) return;
    router.push({ pathname: "/entries/step2", query: { dragging } });
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 780, margin: "0 auto" }}>
      <h1>Today’s Future Me</h1>
      <p style={{ margin: "12px 0" }}><strong>What’s dragging you down today?</strong></p>

      <textarea
        value={dragging}
        onChange={(e) => setDragging(e.target.value)}
        rows={5}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #d1d5db" }}
        placeholder="Be specific…"
      />

      <div style={{ marginTop: 12, textAlign: "right" }}>
        <button onClick={next} style={{ padding: "10px 14px", borderRadius: 999, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
          Next →
        </button>
      </div>
    </main>
  );
}
