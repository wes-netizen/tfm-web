// /pages/teleprompter.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
/** ---- Web Speech API shims (avoid TS globals) ---- */
type SpeechRecognitionEvent = any;
type SpeechRecognition = any;

type RecorderState = "idle" | "countdown" | "recording" | "paused" | "finishing";

const FALLBACK_SCRIPT =
  `Paste your Daily Prompt here, or click "Open in Teleprompter" from the Today page.`;

function TeleprompterPageInner() {
  /* ---------------- State: script + autostart ---------------- */
  const [script, setScript] = useState(FALLBACK_SCRIPT);
  const [autoStart, setAutoStart] = useState(false);
  const [autoFs, setAutoFs] = useState(false);
  const RecognitionCtor =
    typeof window !== "undefined"
      ? (window.SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null)
      : null;

  const recognition = RecognitionCtor ? new (RecognitionCtor as any)() : null; // kept to satisfy TS, not used directly

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const qs = url.searchParams;
    const qScript = qs.get("script");
    const qAutostart = qs.get("autostart");
    const qFs = qs.get("fs");
    if (qScript && qScript.trim()) setScript(decodeURIComponent(qScript));
    else {
      const stored = localStorage.getItem("tp_script_v1");
      if (stored?.trim()) setScript(stored);
    }
    setAutoStart(qAutostart === "1" || qAutostart === "true");
    setAutoFs(qFs === "1" || qFs === "true");
  }, []);

  /* ---------------- UI prefs ---------------- */
  // Default WPM slowed to 40
  const [wpm, setWpm] = useState(105);
  const [fontSize, setFontSize] = useState<number | "fit">("fit"); // auto-fit on phones
  const [lineHeight, setLineHeight] = useState(1.25);
  const [mirror, setMirror] = useState(false);
  const [pipPct, setPipPct] = useState(18); // webcam size %
  const [cameraOffset, setCameraOffset] = useState(0); // -40..40, vertical PiP offset
  const [showHud, setShowHud] = useState(true); // overlay HUD
  const [drawerOpen, setDrawerOpen] = useState(false); // control drawer

  /* ---------------- Media/device state ---------------- */
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [permError, setPermError] = useState("");

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");

  /* ---------------- Refs ---------------- */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedBlobsRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const rafRef = useRef<number | null>(null);

  const startTsRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const wordsRef = useRef<number>(0);
  const scrollRef = useRef<number>(0);

  // These are still present for future speech-driven mode but not used for line-by-line timing now
  const recogRef = useRef<any>(null);
  const spokenCountRef = useRef<number>(0);
  const lastSpeechTsRef = useRef<number>(0);

  const [recState, setRecState] = useState<RecorderState>("idle");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [mp4Url, setMp4Url] = useState("");
  const [transcoding, setTranscoding] = useState(false);
  const [tcError, setTcError] = useState("");

  // Wake lock (keep screen on)
  const wakeLockRef = useRef<any>(null);

  // Remote control
  const bcRef = useRef<BroadcastChannel | null>(null);

  /* ---------------- Tokenize with line breaks preserved ---------------- */
  const tokens = useMemo(() => {
    const s = (script || "").replace(/\r/g, "");
    const rows = s.split("\n");
    const arr: { t: string; isBreak: boolean }[] = [];
    rows.forEach((row, i) => {
      if (!row.trim()) arr.push({ t: "\n", isBreak: true });
      else {
        const parts = row.match(/\S+|\s+/g) || [];
        parts.forEach((p) => arr.push({ t: p, isBreak: false }));
      }
      if (i < rows.length - 1) arr.push({ t: "\n", isBreak: true });
    });
    return arr;
  }, [script]);

  /* ---------------- Duration from WPM ---------------- */
  useEffect(() => {
    const totalWords = (script.match(/\b[\w’'-]+\b/gi) || []).length;
    wordsRef.current = Math.max(1, totalWords);
    // Allow very slow reading (down to ~20 WPM)
    durationRef.current = (wordsRef.current / Math.max(20, wpm)) * 60_000;
  }, [script, wpm]);

  /* ---------------- Device discovery ---------------- */
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    (async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
        if (!camId) setCamId(list.find((d) => d.kind === "videoinput")?.deviceId || "");
        if (!micId) setMicId(list.find((d) => d.kind === "audioinput")?.deviceId || "");
      } catch {
        setPermError("Camera/Microphone permission is required to record.");
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("tp_remote_v1");
    bcRef.current = bc;
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "start") handleStart();
      if (m.type === "pauseResume") handlePauseResume();
      if (m.type === "finish") handleFinish();
      if (m.type === "speed")
        setWpm((v) => Math.max(20, Math.min(260, m.value || v)));
      if (m.type === "font")
        setFontSize((v) => {
          const n = Math.max(
            28,
            Math.min(96, m.value || (typeof v === "number" ? v : 48))
          );
          return n;
        });
      if (m.type === "mirror") setMirror(!!m.value);
      if (m.type === "pip")
        setPipPct((v) => Math.max(10, Math.min(35, m.value || v)));
    };
    return () => bc.close();
  }, []);

  /* ---------------- Fullscreen helpers ---------------- */
  async function goFullscreen() {
    if (!stageRef.current || typeof document === "undefined") return;
    try {
      await stageRef.current.requestFullscreen?.();
      if ("orientation" in screen && (screen.orientation as any)?.lock) {
        try {
          await (screen.orientation as any).lock("landscape");
        } catch {}
      }
      if ("wakeLock" in navigator && (navigator as any).wakeLock?.request) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        } catch {}
      }
    } catch {}
  }
  async function exitFullscreen() {
    try {
      await document.exitFullscreen?.();
    } catch {}
    try {
      await (screen.orientation as any)?.unlock?.();
    } catch {}
    try {
      wakeLockRef.current?.release?.();
    } catch {}
  }

  /* ---------------- Canvas sizing: FULL SCREEN ---------------- */
  function resizeCanvasToViewport() {
    const cvs = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1); // cap to keep performance
    const W = Math.floor(window.innerWidth * dpr);
    const H = Math.floor(window.innerHeight * dpr);
    if (cvs.width !== W || cvs.height !== H) {
      cvs.width = W;
      cvs.height = H;
    }
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => resizeCanvasToViewport();
    window.addEventListener("resize", onResize);
    resizeCanvasToViewport();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------------- Camera preview for PIP ---------------- */
  useEffect(() => {
    (async () => {
      if (!camId || typeof navigator === "undefined") return;
      try {
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: camId ? { exact: camId } : undefined },
          audio: false,
        });
        camStreamRef.current = cam;
        if (videoRef.current) {
          videoRef.current.srcObject = cam;
          await videoRef.current.play();
        }
      } catch {
        setPermError("Unable to access selected camera.");
      }
    })();
  }, [camId]);

  /* ---------------- Word layout + drawing (LINE-BY-LINE) ---------------- */
function layoutAndDraw(now: number) {
  const canvas = canvasRef.current!;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  const marginX = Math.round(W * 0.08);
  const usableW = W - marginX * 2;

  // auto-fit font on phones if set to "fit"
  const basePx =
    typeof fontSize === "number"
      ? fontSize
      : Math.max(36, Math.min(80, Math.round(W * 0.045)));
  const pxLine = Math.round(basePx * lineHeight);

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }

  ctx.fillStyle = "#000";
  ctx.globalAlpha = 0.92;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  ctx.font = `700 ${basePx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "alphabetic";

  // wrap into lines, keeping token identity
  type Chunk = { text: string; isWord: boolean };
  const lines: Chunk[][] = [];
  let current: Chunk[] = [];
  let x = 0;
  for (const tk of tokens) {
    if (tk.isBreak) {
      lines.push(current.length ? current : [{ text: "", isWord: false }]);
      current = [];
      x = 0;
      continue;
    }
    const w = tk.t;
    const width = ctx.measureText(w).width;
    if (x + width > usableW) {
      lines.push(current.length ? current : [{ text: "", isWord: false }]);
      current = [];
      x = 0;
    }
    current.push({ text: w, isWord: /\S/.test(w) });
    x += width;
  }
  if (current.length) lines.push(current);

  const totalLines = Math.max(1, lines.length);
  const elapsed = Math.max(
    0,
    performance.now() - (startTsRef.current || performance.now())
  );

  // Each line gets an equal slice of the total duration
  const lineDurationMs =
    totalLines > 0 && durationRef.current > 0
      ? durationRef.current / totalLines
      : 1;

  let currentLine = Math.floor(elapsed / lineDurationMs);
  if (currentLine >= totalLines) currentLine = totalLines - 1;

  // Scroll so the highlighted line sits a bit above center
  const targetScroll = Math.max(0, currentLine * pxLine - H * 0.35);
  scrollRef.current = targetScroll;

  const startLine = Math.max(0, Math.floor(targetScroll / pxLine) - 2);
  const endLine = Math.min(
    lines.length - 1,
    Math.ceil((targetScroll + H) / pxLine) + 2
  );

  for (let li = startLine; li <= endLine; li++) {
    const y = Math.round(li * pxLine - targetScroll + H / 2);

    const isCurrentLine = li === currentLine;
    const lineAlpha = isCurrentLine ? 1 : 0.7; // same for all non-highlight lines

    let cx = marginX;
    for (const ch of lines[li]) {
      ctx.globalAlpha = lineAlpha;
      // Highlighted line = blue, all others = uniform gray
      ctx.fillStyle = isCurrentLine ? "#c7d2fe" : "#cccccc";
      ctx.fillText(ch.text, cx, y);
      cx += ctx.measureText(ch.text).width;
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  // Webcam PIP (bottom-right) with vertical offset cropping
  if (videoRef.current?.readyState === 4) {
    const pipW = Math.round(W * (pipPct / 100));
    const pipH = Math.round((pipW * 9) / 16);
    const x2 = W - pipW - Math.round(W * 0.015);
    const y2 = H - pipH - Math.round(W * 0.015);

    const vid = videoRef.current;
    const vW = vid.videoWidth || 1280;
    const vH = vid.videoHeight || 720;

    // Crop window allows shifting up/down by ~15% of video height
    const cropH = vH * 0.7;
    const baseY = (vH - cropH) / 2;
    const offsetNorm = Math.max(-1, Math.min(1, cameraOffset / 40)); // -1..1
    const maxShift = vH * 0.15;
    let srcY = baseY + offsetNorm * maxShift;
    if (srcY < 0) srcY = 0;
    if (srcY + cropH > vH) srcY = vH - cropH;

    ctx.drawImage(vid, 0, srcY, vW, cropH, x2, y2, pipW, pipH);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x2, y2, pipW, pipH);
  }

  rafRef.current = requestAnimationFrame(layoutAndDraw);
}

  /* ---------------- Recording ---------------- */
  async function startRecording() {
    if (typeof navigator === "undefined") return;

    // Mic
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
        video: false,
      });
      micStreamRef.current = mic;
    } catch {
      setPermError("Unable to access selected microphone.");
      throw new Error("Mic error");
    }

    // Canvas stream
    const canvas = canvasRef.current!;
    const canvasStream = canvas.captureStream(30);

    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...(micStreamRef.current?.getAudioTracks() ?? []),
    ]);

    recordedBlobsRef.current = [];
    recordedBlobRef.current = null;

    const mr = new MediaRecorder(mixed, {
      mimeType: "video/webm;codecs=vp9,opus",
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    mr.ondataavailable = (e) => {
      if (e.data?.size) recordedBlobsRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(recordedBlobsRef.current, { type: "video/webm" });
      recordedBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    };
    mediaRecorderRef.current = mr;
    mr.start();

    // (Speech recognition is wired but no longer drives highlighting in line-by-line mode)
    spokenCountRef.current = 0;
    lastSpeechTsRef.current = performance.now();
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      const SR = (window as any).webkitSpeechRecognition as any;
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (ev: any) => {
        let text = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript + " ";
        }
        const cnt = (text.match(/\b[\w’'-]+\b/gi) || []).length;
        spokenCountRef.current += cnt;
        lastSpeechTsRef.current = performance.now();
      };
      r.onerror = () => {};
      r.onend = () => {};
      r.start();
      recogRef.current = r;
    } else {
      recogRef.current = null;
    }

    // Render loop
    startTsRef.current = performance.now();
    pausedAtRef.current = 0;
    rafRef.current = requestAnimationFrame(layoutAndDraw);
  }

  function stopRecording() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    recogRef.current?.stop();
    recogRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  async function handleStart() {
    if (recState !== "idle") return;
    setDownloadUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return "";
    });
    setMp4Url((p) => {
      if (p) URL.revokeObjectURL(p);
      return "";
    });
    setTcError("");
    setPermError("");

    resizeCanvasToViewport();
    if (autoFs || /Mobi|Android/i.test(navigator.userAgent)) {
      await goFullscreen();
    }
    setShowHud(false); // stage first
    setRecState("countdown");
    for (let i = 3; i > 0; i--) await new Promise((r) => setTimeout(r, 1000));
    setRecState("recording");
    await startRecording();
  }

  function handlePauseResume() {
    if (recState === "recording") {
      setRecState("paused");
      pausedAtRef.current = performance.now() - startTsRef.current;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      mediaRecorderRef.current?.pause();
      recogRef.current?.stop();
    } else if (recState === "paused") {
      setRecState("recording");
      startTsRef.current = performance.now() - pausedAtRef.current;
      rafRef.current = requestAnimationFrame(layoutAndDraw);
      // restart speech (still optional)
      if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
        const SR = (window as any).webkitSpeechRecognition as { new (): SpeechRecognition };
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = "en-US";
        r.onresult = (ev: SpeechRecognitionEvent) => {
          let text = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++)
            text += ev.results[i][0].transcript + " ";
          const cnt = (text.match(/\b[\w’'-]+\b/gi) || []).length;
          spokenCountRef.current += cnt;
          lastSpeechTsRef.current = performance.now();
        };
        r.start();
        recogRef.current = r;
      }
    }
  }

  async function handleFinish() {
    setRecState("finishing");
    stopRecording();
    await exitFullscreen();
    setShowHud(true);
    setTimeout(() => setRecState("idle"), 300);
  }

  async function convertToMp4() {
    try {
      if (!recordedBlobRef.current) return;
      setTranscoding(true);
      setTcError("");

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      await ffmpeg.load();

      // Write input and transcode
      if (!recordedBlobRef.current) throw new Error("No recording found");
      const arrayBuf = await (recordedBlobRef.current as Blob).arrayBuffer();
      const input = new Uint8Array(arrayBuf); // make it a Uint8Array
      await ffmpeg.writeFile("in.webm", input);

      await ffmpeg.exec([
        "-i",
        "in.webm",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-movflags",
        "+faststart",
        "-b:a",
        "128k",
        "out.mp4",
      ]);

      // Read output and convert to Blob (avoid SharedArrayBuffer issues)
      const out = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
      const safe = new Uint8Array(out);
      const blob = new Blob([safe.buffer], { type: "video/mp4" });

      const url = URL.createObjectURL(blob);
      setMp4Url((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e: any) {
      setTcError(e?.message ?? String(e));
    } finally {
      setTranscoding(false);
    }
  }

  function handleNewSession() {
    // Clear download URLs and revoke any existing blobs
    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setMp4Url((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setTcError("");

    recordedBlobsRef.current = [];
    recordedBlobRef.current = null;

    // Reset timing for the next recording
    spokenCountRef.current = 0;
    lastSpeechTsRef.current = 0;
    startTsRef.current = 0;
    durationRef.current = 0;

    // Keep script so you can reuse/edit, just reset recording state
    setRecState("idle");
  }

  /* ---------------- Autostart ---------------- */
  useEffect(() => {
    if (!autoStart) return;
    const id = setTimeout(() => {
      if (recState === "idle") handleStart();
    }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, camId, micId]);

  /* ---------------- Render ---------------- */
  const isRecording = recState === "recording";
  const isPaused = recState === "paused";
  const stageTap = () => setShowHud((s) => !s);

  return (
    <main
      style={{
        height: "100dvh",
        width: "100vw",
        margin: 0,
        padding: 0,
        fontFamily: "system-ui",
        overflowX: "hidden", // help tablets
      }}
    >
      {/* STAGE (full viewport) */}
      <div
        ref={stageRef}
        onClick={isRecording || isPaused ? stageTap : undefined}
        style={{
          position: "fixed",
          inset: 0,
          background: "#000",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100vw", height: "100dvh", display: "block" }}
        />
        <video ref={videoRef} style={{ display: "none" }} playsInline muted />
        {recState === "countdown" && (
          <div style={overlayCenter}>
            <div style={{ color: "#fff", fontSize: 48, fontWeight: 800 }}>
              Starting…
            </div>
          </div>
        )}

        {/* Minimal HUD while recording (tap to show/hide) */}
        {(isRecording || isPaused) && showHud && (
          <div style={hudBar}>
            <button onClick={handlePauseResume} style={hudBtn}>
              {isRecording ? "Pause" : "Resume"}
            </button>
            <button onClick={handleFinish} style={hudBtnPrimary}>
              Finish
            </button>
          </div>
        )}
      </div>

      {/* Collapsible controls drawer (hidden during recording unless HUD open) */}
      {!isRecording && !isPaused && (
        <div style={drawerWrap}>
          {/* Centered responsive container */}
          <div style={container}>
            <button
              onClick={() => setDrawerOpen((d) => !d)}
              style={drawerToggle}
            >
              {drawerOpen ? "Hide Controls" : "Show Controls"}
            </button>
            {drawerOpen && (
              <div style={drawerBody}>
                <label style={lbl}>Script</label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={8}
                  style={input({ height: 160 })}
                  placeholder="Paste your Daily Prompt…"
                />

                <div style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Camera</label>
                    <select
                      value={camId}
                      onChange={(e) => setCamId(e.target.value)}
                      style={select}
                    >
                      {cams.length === 0 && (
                        <option value="">(No camera detected)</option>
                      )}
                      {cams.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Camera"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Microphone</label>
                    <select
                      value={micId}
                      onChange={(e) => setMicId(e.target.value)}
                      style={select}
                    >
                      {mics.length === 0 && (
                        <option value="">(No mic detected)</option>
                      )}
                      {mics.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Mic"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
  <label style={lbl}>WPM (speed)</label>

  {/* Numeric input */}
  <input
    type="number"
    min={80}
    max={150}
    value={wpm}
    onChange={(e) => {
      const val = parseInt(e.target.value || "105", 10);
      const clamped = Math.max(80, Math.min(150, isNaN(val) ? 105 : val));
      setWpm(clamped);
    }}
    style={input({ marginBottom: 4 })}
  />

  {/* Slider */}
  <input
    type="range"
    min={80}
    max={150}
    step={1}
    value={wpm}
    onChange={(e) => setWpm(parseInt(e.target.value, 10))}
    style={{ width: "100%" }}
  />
</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Font</label>
                    <select
                      value={
                        typeof fontSize === "number" ? String(fontSize) : "fit"
                      }
                      onChange={(e) =>
                        setFontSize(
                          e.target.value === "fit"
                            ? "fit"
                            : Math.max(
                                28,
                                Math.min(96, parseInt(e.target.value, 10))
                              )
                        )
                      }
                      style={select}
                    >
                      <option value="fit">Fit to screen</option>
                      {[36, 42, 48, 56, 64, 72, 80].map((n) => (
                        <option key={n} value={n}>
                          {n}px
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Line height</label>
                    <input
                      type="number"
                      step="0.05"
                      min={1}
                      max={2}
                      value={lineHeight}
                      onChange={(e) =>
                        setLineHeight(
                          parseFloat(e.target.value || "1.25")
                        )
                      }
                      style={input()}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Webcam size (%)</label>
                    <input
                      type="number"
                      min={10}
                      max={35}
                      value={pipPct}
                      onChange={(e) =>
                        setPipPct(parseInt(e.target.value || "18", 10))
                      }
                      style={input()}
                    />
                  </div>
                </div>

                <div style={row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={lbl}>Camera offset (up/down)</label>
                    <input
                      type="range"
                      min={-40}
                      max={40}
                      value={cameraOffset}
                      onChange={(e) =>
                        setCameraOffset(parseInt(e.target.value || "0", 10))
                      }
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginTop: 4,
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={mirror}
                      onChange={(e) => setMirror(e.target.checked)}
                    />
                    Mirror text
                  </label>
                </div>

                {permError && (
                  <div
                    style={{
                      color: "#b91c1c",
                      fontSize: 14,
                      marginTop: 8,
                    }}
                  >
                    {permError}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 10,
                  }}
                >
                  <button onClick={handleStart} style={btnPrimary}>
                    Start & Record
                  </button>
                  <button
                    onClick={() => {
                      try {
                        localStorage.setItem("tp_script_v1", script);
                      } catch {}
                    }}
                    style={btnSecondary}
                  >
                    Save Script
                  </button>
                </div>

                {(downloadUrl || mp4Url) && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {downloadUrl && (
                      <a
                        href={downloadUrl}
                        download="teleprompter.webm"
                        style={btnLink}
                      >
                        ⬇️ Download WEBM
                      </a>
                    )}
                    <button
                      onClick={convertToMp4}
                      disabled={transcoding || !downloadUrl}
                      style={btnSecondary}
                    >
                      {transcoding ? "Converting…" : "Convert to MP4 (beta)"}
                    </button>
                    {mp4Url && (
                      <a
                        href={mp4Url}
                        download="teleprompter.mp4"
                        style={btnLink}
                      >
                        ⬇️ Download MP4
                      </a>
                    )}
                    {tcError && (
                      <div
                        style={{
                          color: "#b91c1c",
                          fontSize: 13,
                        }}
                      >
                        {tcError}
                      </div>
                    )}
                  </div>
                )}

                {(downloadUrl || mp4Url) && (
                  <div style={{ marginTop: 10 }}>
                    <button onClick={handleNewSession} style={btnSecondary}>
                      New session
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- styles ---------- */
const overlayCenter: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.5)",
};
const hudBar: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 16,
  display: "flex",
  justifyContent: "center",
  gap: 10,
};
const hudBtn: React.CSSProperties = {
  background: "#e5e7eb",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 700,
};
const hudBtnPrimary: React.CSSProperties = {
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 700,
};

const drawerWrap: React.CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: 12,
  pointerEvents: "auto",
};
const container: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  margin: "0 auto",
};
const drawerToggle: React.CSSProperties = {
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
  borderRadius: 12,
  padding: "10px 14px",
  fontWeight: 700,
};
const drawerBody: React.CSSProperties = {
  marginTop: 8,
  background: "#fff",
  color: "#111",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
};
const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 8,
  flexWrap: "wrap",
};
const lbl: React.CSSProperties = {
  fontWeight: 600,
  display: "block",
  marginTop: 4,
  marginBottom: 4,
};
const input = (extra?: React.CSSProperties): React.CSSProperties => ({
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: 10,
  background: "#fff",
  color: "#111",
  ...extra,
});
const select: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: 10,
  background: "#fff",
  color: "#111",
};
const btnPrimary: React.CSSProperties = {
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  background: "#e5e7eb",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 999,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
};
const btnLink: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  textDecoration: "none",
  color: "#111",
};

/* ---------- export as client-only ---------- */
export default dynamic(() => Promise.resolve(TeleprompterPageInner), {
  ssr: false,
});
