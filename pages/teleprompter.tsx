// pages/teleprompter.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import { useRouter } from "next/router";

/* ========= Visual tokens ========= */
const baseText = "#EAF2F8";
const faint = "rgba(255,255,255,.70)";
const border = "rgba(255,255,255,.20)";
const panel = "rgba(15,23,42,.88)";
const teal = "#22C55E";
const accent = "#C7D2FE";
const bg = "radial-gradient(circle at top, #1f2937 0, #020617 55%, #000 100%)";

/* ========= Types ========= */
type RecState = "idle" | "recording" | "paused" | "finished";

type TeleSettings = {
  wpm: number; // 80–150, default 115
  fontSize: number;
  lineHeight: number;
  mirror: boolean;
  autoStart: boolean;
};

/* ========= Helpers ========= */
const isBrowser = typeof window !== "undefined";

const DEFAULT_SCRIPT =
  "Today, I choose to create my future with intention.\n" +
  "I give myself permission to be honest about what is blocking me.\n" +
  "I speak with courage, clarity, and compassion—first to myself, then to others.\n" +
  "Every word I say here is a seed for Today’s Future Me.";

function countWords(s: string): number {
  const m = s.match(/\b[\w’'-]+\b/gi);
  return m ? m.length : 0;
}

/** Build line meta so we can highlight by line while timing by words */
function buildLineMeta(script: string) {
  const rawLines = script
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (!rawLines.length) {
    return {
      lines: [""],
      wordsPerLine: [1],
      totalWords: 1,
      cumulativeWords: [1],
    };
  }

  const wordsPerLine: number[] = [];
  let totalWords = 0;
  const cumulativeWords: number[] = [];

  for (const line of rawLines) {
    const w = Math.max(1, countWords(line));
    totalWords += w;
    wordsPerLine.push(w);
    cumulativeWords.push(totalWords);
  }

  return {
    lines: rawLines,
    wordsPerLine,
    totalWords,
    cumulativeWords,
  };
}

function findCurrentLineIndex(
  elapsedMs: number,
  wpm: number,
  cumulativeWords: number[]
): number {
  if (!cumulativeWords.length || wpm <= 0) return 0;
  const wordsPerMs = wpm / 60000;
  const wordsSpoken = elapsedMs * wordsPerMs;

  let idx = 0;
  while (idx < cumulativeWords.length && cumulativeWords[idx] <= wordsSpoken) {
    idx++;
  }
  return Math.min(idx, cumulativeWords.length - 1);
}

/* ========= CSS tokens ========= */
const hudLabel: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: faint,
};

const sliderStyle: CSSProperties = {
  width: "100%",
};

/* ========= Inner component (browser only) ========= */
function TeleprompterInner() {
  const router = useRouter();

  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [settings, setSettings] = useState<TeleSettings>({
    wpm: 115,
    fontSize: 32,
    lineHeight: 1.4,
    mirror: false,
    autoStart: false,
  });

  const [recState, setRecState] = useState<RecState>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [tcError, setTcError] = useState<string>("");
  const [controlsOpen, setControlsOpen] = useState<boolean>(false);
  const [sessionComplete, setSessionComplete] = useState<boolean>(false);

  // DOM refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedBlobsRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);

  const startTsRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number | null>(null);

  // Precomputed line meta (based on logical lines, not wrapped)
  const lineMeta = useMemo(() => buildLineMeta(script), [script]);

  /* ========= Load script from localStorage (TFM entry) ========= */
  useEffect(() => {
    if (!isBrowser) return;
    try {
      const stored = window.localStorage.getItem("tfm_script");
      if (stored && stored.trim()) {
        setScript(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  /* ========= Camera attach / stop ========= */
  const stopTracks = useCallback(() => {
    if (!isBrowser) return;
    const v = videoRef.current;
    if (v && v.srcObject instanceof MediaStream) {
      v.srcObject.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
  }, []);

  const attachCamera = useCallback(async () => {
    if (!isBrowser || !videoRef.current) return;

    // iOS-safe: don’t use deviceId – let browser pick default camera
    const constraints: MediaStreamConstraints = {
      video: true,
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  }, []);

  /* ========= Drawing loop ========= */
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let elapsed = 0;

    if (recState === "recording") {
      if (startTsRef.current === 0) startTsRef.current = now;
      elapsed = now - startTsRef.current - pauseOffsetRef.current;
    } else if (recState === "paused" && startTsRef.current !== 0) {
      if (lastPauseStartRef.current === null) {
        lastPauseStartRef.current = now;
      }
      elapsed =
        lastPauseStartRef.current - startTsRef.current - pauseOffsetRef.current;
    } else if (recState === "finished") {
      elapsed = (lineMeta.totalWords / settings.wpm) * 60000;
    } else {
      elapsed = 0;
    }

    const { lines, cumulativeWords } = lineMeta;
    const currentLineIndex = findCurrentLineIndex(
      elapsed,
      settings.wpm,
      cumulativeWords
    );

    // Canvas size
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    ctx.save();

    // Optional mirror mode (for physical glass teleprompter)
    if (settings.mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    // Background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // Camera PIP (top-right)
    const pipWidth = Math.floor(width * 0.22);
    const pipHeight = Math.floor(height * 0.27);
    const pipMarginX = 24;
    const pipMarginY = 24;
    const pipX = settings.mirror ? pipMarginX : width - pipWidth - pipMarginX;
    const pipY = pipMarginY;

    if (video.readyState >= 2) {
      ctx.save();
      ctx.beginPath();
      const radius = 18;
      ctx.moveTo(pipX + radius, pipY);
      ctx.lineTo(pipX + pipWidth - radius, pipY);
      ctx.quadraticCurveTo(
        pipX + pipWidth,
        pipY,
        pipX + pipWidth,
        pipY + radius
      );
      ctx.lineTo(pipX + pipWidth, pipY + pipHeight - radius);
      ctx.quadraticCurveTo(
        pipX + pipWidth,
        pipY + pipHeight,
        pipX + pipWidth - radius,
        pipY + pipHeight
      );
      ctx.lineTo(pipX + radius, pipY + pipHeight);
      ctx.quadraticCurveTo(
        pipX,
        pipY + pipHeight,
        pipX,
        pipY + pipHeight - radius
      );
      ctx.lineTo(pipX, pipY + radius);
      ctx.quadraticCurveTo(pipX, pipY, pipX + radius, pipY);
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(video, pipX, pipY, pipWidth, pipHeight);
      ctx.restore();

      ctx.strokeStyle = "rgba(148,163,184,.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(pipX, pipY, pipWidth, pipHeight);
    }

    // Teleprompter text
    const margin = 40;
    const rawFontSize = settings.fontSize;
    const lineGapBase = rawFontSize * settings.lineHeight;

    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    // First pass: compute max width at requested font size
    ctx.font =
      `${rawFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

    let maxLineWidth = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }

    const maxAllowedWidth = width - margin * 2;
    let effectiveFontSize = rawFontSize;

    if (maxLineWidth > maxAllowedWidth && maxLineWidth > 0) {
      const ratio = maxAllowedWidth / maxLineWidth;
      effectiveFontSize = Math.max(14, Math.floor(rawFontSize * ratio));
    }

    const lineGap = effectiveFontSize * settings.lineHeight;
    ctx.font =
      `${effectiveFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

    const centerX = width / 2;
    const centerY = height / 2;
    const startY = centerY - currentLineIndex * lineGap - lineGap / 2;

    // frame
    ctx.strokeStyle = "rgba(148,163,184,.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin / 2, margin / 2, width - margin, height - margin);

    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * lineGap;
      if (y < margin || y > height - margin) continue;

      const text = lines[i];

      if (i === currentLineIndex) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(margin / 2, y - 6, width - margin, lineGap + 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
      } else {
        ctx.fillStyle = baseText;
      }

      ctx.fillText(text, centerX, y);
    }

    ctx.restore();
    rafRef.current = requestAnimationFrame(drawFrame);
  }, [lineMeta, recState, settings.wpm, settings.fontSize, settings.lineHeight, settings.mirror]);

  useEffect(() => {
    if (!isBrowser) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      stopTracks();
      if (mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
        mediaRecorderRef.current = null;
      }
    };
  }, [drawFrame, stopTracks]);

  /* ========= Recording ========= */
  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    stopTracks();
  }, [stopTracks]);

  const handleStart = useCallback(async () => {
    if (!isBrowser || recState === "recording") return;
    setTcError("");
    setSessionComplete(false);

    // If MediaRecorder is not supported, just show message and bail.
    if (typeof window !== "undefined" && !(window as any).MediaRecorder) {
      setTcError(
        "Recording is not supported in this browser. You can still read your script for alignment."
      );
      return;
    }

    try {
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });

      recordedBlobsRef.current = [];
      recordedBlobRef.current = null;
      startTsRef.current = 0;
      pauseOffsetRef.current = 0;
      lastPauseStartRef.current = null;

      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas not ready");

      // Turn camera on only when we start recording
      await attachCamera();

      const displayStream = canvas.captureStream(30);

      // iOS-safe: don't use deviceId, just request default mic
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const fullStream = new MediaStream();
      displayStream.getVideoTracks().forEach((t) => fullStream.addTrack(t));
      audioStream.getAudioTracks().forEach((t) => fullStream.addTrack(t));

      const options: MediaRecorderOptions = {
        mimeType: "video/webm;codecs=vp9,opus",
      };
      const mr = new MediaRecorder(fullStream, options);

      mr.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedBlobsRef.current.push(event.data);
        }
      };

      mr.onstop = () => {
        fullStream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedBlobsRef.current, {
          type: "video/webm",
        });
        recordedBlobRef.current = blob;

        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);

        try {
          if (typeof window !== "undefined") {
            const raw =
              window.localStorage.getItem("tfm_video_history") || "[]";
            const arr = JSON.parse(raw) as any[];
            arr.push({
              createdAt: new Date().toISOString(),
              script,
            });
            window.localStorage.setItem(
              "tfm_video_history",
              JSON.stringify(arr)
            );
          }
        } catch {
          // ignore
        }

        setRecState("finished");
        setSessionComplete(true);
        stopTracks();
      };

      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecState("recording");
    } catch (e: any) {
      console.error(e);
      setTcError(e?.message || "Unable to start recording");
      stopMediaRecorder();
      setRecState("idle");
    }
  }, [attachCamera, recState, script, stopMediaRecorder, stopTracks]);

  const handlePauseResume = useCallback(() => {
    if (!isBrowser) return;
    if (!mediaRecorderRef.current) return;

    if (recState === "recording") {
      mediaRecorderRef.current.pause();
      setRecState("paused");
      lastPauseStartRef.current =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    } else if (recState === "paused") {
      mediaRecorderRef.current.resume();
      setRecState("recording");
      if (lastPauseStartRef.current != null) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        pauseOffsetRef.current += now - lastPauseStartRef.current;
        lastPauseStartRef.current = null;
      }
    }
  }, [recState]);

  const handleStop = useCallback(() => {
    if (!isBrowser) return;
    if (!mediaRecorderRef.current) {
      stopTracks();
      setRecState("finished");
      setSessionComplete(true);
      return;
    }
    stopMediaRecorder();
    // onstop handler will set finished + sessionComplete
  }, [stopMediaRecorder, stopTracks]);

  const handleResetRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }

    stopTracks();

    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });

    setTcError("");
    recordedBlobsRef.current = [];
    recordedBlobRef.current = null;
    startTsRef.current = 0;
    pauseOffsetRef.current = 0;
    lastPauseStartRef.current = null;
    setSessionComplete(false);
    setRecState("idle");
  }, [stopTracks]);

  /* ========= Completion actions ========= */

  const handleCompleteLog = useCallback(() => {
    // Video session already logged into tfm_video_history in onstop.
    router.push("/history");
  }, [router]);

  const handleCompleteDownloadAndLog = useCallback(() => {
    if (!downloadUrl) return;
    try {
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = "tfm-session.webm";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // ignore download errors
    }
    router.push("/history");
  }, [downloadUrl, router]);

  /* ========= Auto-start ========= */
  useEffect(() => {
    if (!settings.autoStart) return;
    if (recState !== "idle") return;
    const id = setTimeout(() => {
      handleStart();
    }, 700);
    return () => clearTimeout(id);
  }, [settings.autoStart, recState, handleStart]);

  /* ========= UI helpers ========= */
  const isRecording = recState === "recording";
  const isPaused = recState === "paused";

  const handleChangeSettings = <K extends keyof TeleSettings>(
    key: K,
    value: TeleSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: bg,
        color: baseText,
        padding: "12px 16px 24px",
        boxSizing: "border-box",
      }}
    >
      <style jsx global>{`
        body {
          margin: 0;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
            sans-serif;
        }
      `}</style>

      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <Image
          src="/tfm_logo.png"
          alt="TFM"
          width={36}
          height={36}
          style={{ borderRadius: 8, objectFit: "contain" }}
        />
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Re-Enforce Alignment</h1>
          <div style={{ fontSize: 12, color: faint }}>
            Read your Future Me script while the app records you.
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <div style={{ fontSize: 12, color: faint }}>
            WPM {settings.wpm} · Font {settings.fontSize}px
          </div>
          <button
            type="button"
            onClick={() => {
              stopTracks();
              router.push("/today");
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "transparent",
              color: baseText,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Back to Today
          </button>
        </div>
      </header>

      {/* Short how-to */}
      <section
        style={{
          background: panel,
          borderRadius: 14,
          border: `1px solid ${border}`,
          padding: 10,
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        <strong>How this page works</strong>
        <p style={{ marginTop: 4, marginBottom: 2, color: faint }}>
          Your words scroll in front of you while the camera records. Each
          session is one rep of alignment with your Future Me.
        </p>
        <p style={{ margin: 0, color: faint }}>
          Write it, see it, read it, say it, and you will hear it. This page
          helps you build that repetition on camera.
        </p>
      </section>

      {/* Teleprompter full-width */}
      <section
        style={{
          background: "rgba(15,23,42,.98)",
          borderRadius: 18,
          border: `1px solid ${border}`,
          padding: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: 420,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 13, color: faint }}>
            Re-Enforce Alignment Stage
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                handleChangeSettings("autoStart", !settings.autoStart)
              }
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${
                  settings.autoStart ? teal : "rgba(148,163,184,.5)"
                }`,
                background: settings.autoStart
                  ? "rgba(34,197,94,.15)"
                  : "transparent",
                color: settings.autoStart ? teal : faint,
                cursor: "pointer",
              }}
            >
              Auto start
            </button>
            <button
              type="button"
              onClick={handleResetRecording}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid rgba(148,163,184,.5)`,
                background: "transparent",
                color: faint,
                cursor: "pointer",
              }}
            >
              New session
            </button>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            flex: 1,
            borderRadius: 16,
            overflow: "hidden",
            background: "black",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          <video ref={videoRef} muted playsInline style={{ display: "none" }} />
        </div>

        {/* Recording controls */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={handleStart}
            disabled={isRecording || isPaused}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "none",
              background: isRecording || isPaused ? "#4b5563" : "#ef4444",
              color: "#f9fafb",
              fontWeight: 700,
              fontSize: 13,
              cursor: isRecording || isPaused ? "default" : "pointer",
            }}
          >
            ● Start
          </button>
          <button
            type="button"
            onClick={handlePauseResume}
            disabled={recState === "idle" || recState === "finished"}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "transparent",
              color: baseText,
              fontSize: 13,
              cursor:
                recState === "idle" || recState === "finished"
                  ? "default"
                  : "pointer",
            }}
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={recState !== "recording" && recState !== "paused"}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "transparent",
              color: baseText,
              fontSize: 13,
              cursor:
                recState !== "recording" && recState !== "paused"
                  ? "default"
                  : "pointer",
            }}
          >
            Stop
          </button>

          {recState === "recording" && (
            <span style={{ fontSize: 12, color: "#f97316" }}>
              Recording… speak naturally.
            </span>
          )}
          {recState === "finished" && (
            <span style={{ fontSize: 12, color: teal }}>
              Session complete. Review below.
            </span>
          )}
        </div>

        {tcError && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#fecaca",
            }}
          >
            {tcError}
          </div>
        )}

        {/* Completion panel */}
        {recState === "finished" && (
          <section
            style={{
              marginTop: 12,
              borderRadius: 18,
              border: `1px solid ${border}`,
              padding: 12,
              background: "rgba(15,23,42,.95)",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              Today&apos;s alignment rep is done.
            </h2>
            <p
              style={{
                marginTop: 4,
                marginBottom: 10,
                fontSize: 13,
                color: faint,
              }}
            >
              You just spoke your CSC, gratitude, actions, and prayer out loud.
              Log this rep, download the video if it&apos;s available, or record
              again to sharpen your delivery.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={handleCompleteLog}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  color: "#020617",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Log Entry
              </button>

              <button
                type="button"
                onClick={handleCompleteDownloadAndLog}
                disabled={!downloadUrl}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${downloadUrl ? "#e5e7eb" : border}`,
                  background: downloadUrl ? "rgba(148,163,184,.15)" : "transparent",
                  color: downloadUrl ? baseText : "rgba(148,163,184,.7)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: downloadUrl ? "pointer" : "default",
                }}
              >
                Download &amp; Log Entry
              </button>

              <button
                type="button"
                onClick={handleResetRecording}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: baseText,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Re-Record
              </button>
            </div>

            {!downloadUrl && (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "#fb923c",
                }}
              >
                Your browser may not support video download for this session.
                The rep is still logged.
              </p>
            )}
          </section>
        )}

        {/* Legacy inline download message (kept) */}
        {downloadUrl && recState !== "finished" && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <a
              href={downloadUrl}
              download="tfm-session.webm"
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                fontSize: 12,
                color: baseText,
                textDecoration: "none",
              }}
            >
              Download video
            </a>
            <span style={{ fontSize: 11, color: faint }}>
              (Saved to local video history)
            </span>
          </div>
        )}
      </section>

      {/* Script + settings BELOW teleprompter, collapsible */}
      <section
        style={{
          marginTop: 16,
          background: panel,
          borderRadius: 18,
          border: `1px solid ${border}`,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...hudLabel, textTransform: "none", fontSize: 13 }}>
            Script &amp; Settings
          </div>
          <button
            type="button"
            onClick={() => setControlsOpen((v) => !v)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "transparent",
              color: baseText,
              cursor: "pointer",
            }}
          >
            {controlsOpen ? "Hide" : "Show"}
          </button>
        </div>

        {controlsOpen && (
          <>
            {/* Script editor */}
            <div>
              <div style={hudLabel}>Script</div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={8}
                style={{
                  marginTop: 4,
                  width: "100%",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(15,23,42,.9)",
                  color: baseText,
                  padding: 10,
                  fontSize: 14,
                  lineHeight: 1.5,
                  resize: "vertical",
                }}
                placeholder="Paste or type your script, one phrase per line."
              />
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: faint,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {lineMeta.lines.length} lines · {lineMeta.totalWords} words
                </span>
                <button
                  type="button"
                  onClick={() => setScript(DEFAULT_SCRIPT)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#93c5fd",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Reset sample
                </button>
              </div>
            </div>

            {/* WPM slider */}
            <div>
              <div
                style={{
                  ...hudLabel,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Scroll speed (WPM)</span>
                <span style={{ fontSize: 11, color: baseText }}>
                  {settings.wpm} wpm
                </span>
              </div>
              <input
                type="range"
                min={80}
                max={150}
                step={1}
                value={settings.wpm}
                onChange={(e) =>
                  handleChangeSettings("wpm", Number(e.target.value) || 115)
                }
                style={sliderStyle}
              />
            </div>

            {/* Font size */}
            <div>
              <div
                style={{
                  ...hudLabel,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Font size</span>
                <span style={{ fontSize: 11, color: baseText }}>
                  {settings.fontSize}px
                </span>
              </div>
              <input
                type="range"
                min={22}
                max={44}
                step={1}
                value={settings.fontSize}
                onChange={(e) =>
                  handleChangeSettings("fontSize", Number(e.target.value) || 32)
                }
                style={sliderStyle}
              />
            </div>

            {/* Line height */}
            <div>
              <div
                style={{
                  ...hudLabel,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Line spacing</span>
                <span style={{ fontSize: 11, color: baseText }}>
                  {settings.lineHeight.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={120}
                max={180}
                step={5}
                value={Math.round(settings.lineHeight * 100)}
                onChange={(e) =>
                  handleChangeSettings(
                    "lineHeight",
                    Number(e.target.value) / 100 || 1.4
                  )
                }
                style={sliderStyle}
              />
            </div>

            {/* Mirror toggle */}
            <div
              style={{
                marginTop: 4,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <span style={hudLabel}>Mirror for physical teleprompter</span>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  color: baseText,
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.mirror}
                  onChange={(e) =>
                    handleChangeSettings("mirror", e.target.checked)
                  }
                />
                <span>Mirror text</span>
              </label>
            </div>
            {settings.mirror && (
              <div style={{ fontSize: 11, color: faint, marginTop: 2 }}>
                Use your display / OBS settings to mirror the canvas output when
                using a glass teleprompter.
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

/* ========= Page wrapper (SSR-safe) ========= */
export default function TeleprompterPage() {
  if (typeof window === "undefined") {
    return null;
  }
  return <TeleprompterInner />;
}
