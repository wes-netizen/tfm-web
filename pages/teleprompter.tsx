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
  wpm: number; // 80–150, default 105
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
    wpm: 105,
    fontSize: 32,
    lineHeight: 1.4,
    mirror: false,
    autoStart: false,
  });

  const [recState, setRecState] = useState<RecState>("idle");
  const [camId, setCamId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);

  const [downloadUrl, setDownloadUrl] = useState<string>("");
  const [tcError, setTcError] = useState<string>("");

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

  // Precomputed line meta
  const lineMeta = useMemo(() => buildLineMeta(script), [script]);

  /* ========= Devices ========= */
  useEffect(() => {
    if (!isBrowser) return;

    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devs) => {
        const cams = devs.filter((d) => d.kind === "videoinput");
        const mics = devs.filter((d) => d.kind === "audioinput");
        if (cams[0]) setCamId(cams[0].deviceId);
        if (mics[0]) setMicId(mics[0].deviceId);
      })
      .catch(() => {
        // ignore
      });
  }, []);

  /* ========= Camera attach ========= */
  const attachCamera = useCallback(async () => {
    if (!isBrowser || !videoRef.current) return;

    const constraints: MediaStreamConstraints = {
      video: camId ? { deviceId: { exact: camId } } : true,
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  }, [camId]);

  useEffect(() => {
    if (!isBrowser) return;
    attachCamera().catch(() => {});
  }, [attachCamera]);

  /* ========= Drawing loop ========= */
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    let elapsed = 0;

    if (recState === "recording") {
      if (startTsRef.current === 0) startTsRef.current = now;
      elapsed = now - startTsRef.current - pauseOffsetRef.current;
    } else if (recState === "paused" && startTsRef.current !== 0) {
      if (lastPauseStartRef.current === null) {
        lastPauseStartRef.current = now;
      }
      elapsed = lastPauseStartRef.current - startTsRef.current - pauseOffsetRef.current;
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

    // Background
    ctx.save();
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // Camera PIP
    const pipWidth = Math.floor(width * 0.28);
    const pipHeight = Math.floor(height * 0.35);
    const pipX = width - pipWidth - 24;
    const pipY = 24;

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
    const textWidth = width - margin * 2 - pipWidth * 0.3;
    const fontSize = settings.fontSize;
    const lineGap = fontSize * settings.lineHeight;

    ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";

    const centerY = height / 2;
    const startY = centerY - currentLineIndex * lineGap - lineGap / 2;

    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * lineGap;
      if (y < margin - lineGap || y > height - margin + lineGap) continue;

      const text = lines[i];
      const x = margin;

      if (i === currentLineIndex) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(
          margin - 16,
          y - 6,
          textWidth + 32,
          lineGap + 12
        );
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
      } else {
        ctx.fillStyle = baseText;
      }

      ctx.fillText(text, x, y);
    }

    ctx.restore();

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [lineMeta, recState, settings.wpm, settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    if (!isBrowser) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [drawFrame]);

  /* ========= Recording ========= */
  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    if (!isBrowser) return;
    const v = videoRef.current;
    if (v && v.srcObject instanceof MediaStream) {
      v.srcObject.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!isBrowser || recState === "recording") return;
    setTcError("");

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

      const displayStream = canvas.captureStream(30);

      const audioConstraints: MediaStreamConstraints = {
        audio: micId ? { deviceId: { exact: micId } } : true,
        video: false,
      };
      const audioStream = await navigator.mediaDevices.getUserMedia(
        audioConstraints
      );

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
        setRecState("finished");
      };

      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecState("recording");
    } catch (e: any) {
      setTcError(e?.message || "Unable to start recording");
      stopTracks();
      stopMediaRecorder();
      setRecState("idle");
    }
  }, [micId, recState, stopMediaRecorder, stopTracks]);

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
    if (!mediaRecorderRef.current) return;
    stopMediaRecorder();
  }, [stopMediaRecorder]);

  const handleResetRecording = useCallback(() => {
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

    setRecState("idle");
  }, []);

  /* ========= Auto-start ========= */
  useEffect(() => {
    if (!settings.autoStart) return;
    if (recState !== "idle") return;
    const id = setTimeout(() => {
      handleStart();
    }, 700);
    return () => clearTimeout(id);
  }, [settings.autoStart, recState, handleStart]);

  /* ========= UI ========= */
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
        .tele-grid {
          display: grid;
          grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.1fr);
          gap: 16px;
        }
        @media (max-width: 900px) {
          .tele-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>

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
          <h1 style={{ margin: 0, fontSize: 20 }}>TFM Teleprompter</h1>
          <div style={{ fontSize: 12, color: faint }}>
            Line-by-line guidance with camera overlay
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <div style={{ fontSize: 12, color: faint }}>
            WPM {settings.wpm} · Font {settings.fontSize}px
          </div>
          <button
            type="button"
            onClick={() => router.push("/today")}
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

      <div className="tele-grid">
        {/* LEFT: Teleprompter stage */}
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
            <div style={{ fontSize: 13, color: faint }}>Teleprompter Stage</div>
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
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                display: "none",
              }}
            />
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
                Finished. You can download below.
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

          {/* Download row */}
          {downloadUrl && (
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
                download="tfm-teleprompter.webm"
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  fontSize: 12,
                  color: baseText,
                  textDecoration: "none",
                }}
              >
                Download .webm
              </a>
            </div>
          )}
        </section>

        {/* RIGHT: Script + settings */}
        <section
          style={{
            background: panel,
            borderRadius: 18,
            border: `1px solid ${border}`,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Script editor */}
          <div>
            <div style={hudLabel}>Script</div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={10}
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
                handleChangeSettings("wpm", Number(e.target.value) || 105)
              }
              style={sliderStyle}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: faint,
                marginTop: 2,
              }}
            >
              <span>80</span>
              <span>105 (default)</span>
              <span>150</span>
            </div>
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

          {/* Mirror toggle (info only for now) */}
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
        </section>
      </div>
    </main>
  );
}

/* ========= Page wrapper (SSR-safe) ========= */
/** On the server, render nothing; on the client, render the full app. */
export default function TeleprompterPage() {
  if (typeof window === "undefined") {
    return null;
  }
  return <TeleprompterInner />;
}
