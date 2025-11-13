import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

function TeleprompterRemoteInner() {
  const bcRef = useRef<BroadcastChannel | null>(null);
  const [wpm, setWpm] = useState<number>(150);
  const [fontSize, setFontSize] = useState<number>(48);
  const [mirror, setMirror] = useState<boolean>(false);
  const [pip, setPip] = useState<number>(18);
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      setSupported(false);
      return;
    }
    const bc = new BroadcastChannel("tp_remote_v1");
    bcRef.current = bc;
    return () => bc.close();
  }, []);

  const send = (type: string, value?: any) => {
    bcRef.current?.postMessage({ type, value });
  };

  if (!supported) {
    return (
      <main style={{ padding: 16, fontFamily: "system-ui" }}>
        <h1>Teleprompter Remote</h1>
        <p>Your browser doesn’t support BroadcastChannel. Use a modern Chromium, Firefox, or Safari.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, fontFamily: "system-ui", color: "#111", maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ margin: "8px 0 12px" }}>Teleprompter Remote</h1>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => send("start")} style={btnPrimary()}>Start</button>
          <button onClick={() => send("pauseResume")} style={btnSecondary()}>Pause/Resume</button>
          <button onClick={() => send("finish")} style={btnPrimary()}>Finish</button>
        </div>

        <label>
          <div>WPM</div>
          <input
            type="number"
            value={wpm}
            min={60}
            max={260}
            onChange={(e) => setWpm(parseInt(e.target.value || "150", 10))}
            onBlur={() => send("speed", wpm)}
            style={input()}
          />
        </label>

        <label>
          <div>Font size (px)</div>
          <input
            type="number"
            value={fontSize}
            min={28}
            max={96}
            onChange={(e) => setFontSize(parseInt(e.target.value || "48", 10))}
            onBlur={() => send("font", fontSize)}
            style={input()}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => { setMirror(e.target.checked); send("mirror", e.target.checked); }}
          />
          Mirror text
        </label>

        <label>
          <div>Webcam PIP size (%)</div>
          <input
            type="number"
            min={10}
            max={35}
            value={pip}
            onChange={(e) => setPip(parseInt(e.target.value || "18", 10))}
            onBlur={() => send("pip", pip)}
            style={input()}
          />
        </label>
      </div>
    </main>
  );
}

function btnPrimary(): React.CSSProperties {
  return { background: "#111827", color: "#fff", border: "1px solid #111827", borderRadius: 999, padding: "10px 14px", fontWeight: 700, cursor: "pointer" };
}
function btnSecondary(): React.CSSProperties {
  return { background: "#e5e7eb", color: "#111", border: "1px solid #d1d5db", borderRadius: 999, padding: "8px 12px", fontWeight: 700, cursor: "pointer" };
}
function input(): React.CSSProperties {
  return { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: 8 };
}

export default dynamic(() => Promise.resolve(TeleprompterRemoteInner), { ssr: false });