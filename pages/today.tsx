import { useEffect, useState } from "react";
// BEFORE: import { getJSON, postJSON } from "@/lib/http";
import { getJSON, postJSON } from "@/lib/http";

export default function Today() {
  const [health, setHealth] = useState<string>("…checking");
  const [input, setInput] = useState("test");
  const [coach, setCoach] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJSON<{ ok: boolean; ts: number }>("/api/health")
      .then((d) => setHealth(d.ok ? "ok" : "not ok"))
      .catch((e) => setHealth(`error: ${String(e)}`));
  }, []);

  async function onGenerate() {
    setErr(null);
    setCoach(null);
    try {
      const data = await postJSON<{ coach?: string; [k: string]: unknown }>(
        "/api/entries/generate",
        { focus: input, want: { coach: true } }
      );
      setRaw(data);
      setCoach(data.coach ?? "(no coach text)");
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Today</h1>

      <p>Health: {health}</p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: 320 }}
        />
        <button onClick={onGenerate}>Generate</button>
      </div>

      {err && <p style={{ color: "crimson" }}>Error: {err}</p>}

      <h3>Coach</h3>
      <p>{coach ?? "–"}</p>

      <details>
        <summary>Raw response</summary>
        <pre>{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </main>
  );
}