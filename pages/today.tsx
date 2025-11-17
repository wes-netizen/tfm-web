// pages/today.tsx
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";

type Step = "entry" | "confirm" | "coach";

type CoachApiResponse = {
  coach?: string;
  csc?: string[];
  grateful?: string[];
  gratefulList?: string[];
  actions?: string[];
  actionGuide?: string[];
  prayers?: string[];
  prayerList?: string[];
  quote?: string;
  bible?: { text: string; ref: string } | null;
  raw?: string;
};

type FocusApiResponse = {
  focusLine: string;
  explanation: string;
};

type SourceKey = "blocking" | "focus" | "building" | "win";
type ChoiceSection = "csc" | "grateful" | "action" | "prayer";

const SECTION_LABELS: Record<SourceKey, string> = {
  blocking: "BLOCKING",
  focus: "FOCUS",
  building: "BUILDING",
  win: "WIN",
};

const CONFIRM_QUESTION: Record<SourceKey, string> = {
  blocking: "Is this what is blocking you today?",
  focus: "Is this what you want to focus on today?",
  building: "Is this what you want more of today?",
  win: "Is this the WIN you want for today?",
};

// removes leading bullets, dashes, or whitespace
const stripBullets = (s: string) => s.replace(/^[•\-\s]+/, "").trim();

/** Generic prefix helper for CSC / Gratitude / Actions */
const forcePrefix = (line: string, prefix: string) => {
  const clean = stripBullets(line);
  const lower = clean.toLowerCase();
  if (lower.startsWith(prefix.toLowerCase())) return clean;
  return `${prefix} ${clean}`;
};

/** Remove duplicates & empty lines after normalisation */
const dedupeStrings = (lines: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const s = stripBullets(raw).replace(/\s+/g, " ").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

/** Prayer-specific normaliser – guarantees exactly one clean prefix */
const normalizePrayerLine = (line: string): string => {
  const clean = stripBullets(line);
  const lower = clean.toLowerCase();

  const patterns = [
    "i pray for",
    "i'm praying for",
    "i am praying for",
    "pray for",
    "praying for",
  ];

  let body = clean;
  for (const p of patterns) {
    if (lower.startsWith(p)) {
      body = clean.slice(p.length).trimStart();
      break;
    }
  }

  if (!body) {
    return "I am praying for clarity and courage today.";
  }
  return `I am praying for ${body}`;
};

export default function TodayPage() {
  const router = useRouter();

  // --- Fix hydration error for date ---
  const [todayString, setTodayString] = useState("");
  useEffect(() => {
    setTodayString(new Date().toLocaleDateString());
  }, []);

  const [step, setStep] = useState<Step>("entry");

  // entry fields
  const [blocking, setBlocking] = useState("");
  const [focus, setFocus] = useState("");
  const [building, setBuilding] = useState("");
  const [win, setWin] = useState("");

  const [focusSource, setFocusSource] = useState<SourceKey | null>(null);

  // restated focus
  const [confirmedFocus, setConfirmedFocus] = useState("");
  const [focusExplanation, setFocusExplanation] = useState("");

  // generation options
  const [includeBible, setIncludeBible] = useState(false);

  // AI output
  const [coachText, setCoachText] = useState("");
  const [cscItems, setCscItems] = useState<string[]>([]);
  const [gratefulItems, setGratefulItems] = useState<string[]>([]);
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [prayerItems, setPrayerItems] = useState<string[]>([]);
  const [quote, setQuote] = useState<string | null>(null);
  const [bible, setBible] = useState<{ text: string; ref: string } | null>(
    null
  );

  // selection state – one choice per section
  const [selCSC, setSelCSC] = useState<number | null>(null);
  const [selGrateful, setSelGrateful] = useState<number | null>(null);
  const [selAction, setSelAction] = useState<number | null>(null);
  const [selPrayer, setSelPrayer] = useState<number | null>(null);

  // final combined script popup
  const [showFinal, setShowFinal] = useState(false);
  const [finalScript, setFinalScript] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------- helpers ---------- */

  const getSourceText = (): { key: SourceKey; value: string } | null => {
    if (!focusSource) return null;
    const map: Record<SourceKey, string> = {
      blocking,
      focus,
      building,
      win,
    };
    return { key: focusSource, value: map[focusSource].trim() };
  };

  const normalizeArray = (v?: string[] | string): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };

  const handleChoiceSelect = (section: ChoiceSection, idx: number) => {
    if (section === "csc") setSelCSC(idx);
    if (section === "grateful") setSelGrateful(idx);
    if (section === "action") setSelAction(idx);
    if (section === "prayer") setSelPrayer(idx);
  };

  /* ---------- focus restatement ---------- */

  const handleRestateFocus = async () => {
    setError(null);

    const source = getSourceText();
    if (!source || !source.value) {
      setError("First choose a card and write a short entry inside it.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/entries/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: source.value }),
      });

      if (!res.ok) {
        throw new Error(`Focus API error ${res.status}`);
      }

      const data = (await res.json()) as FocusApiResponse;

      setConfirmedFocus(data.focusLine?.trim() || "");
      setFocusExplanation(
        data.explanation?.trim() || "Consciously creating your future self."
      );
      setStep("confirm");
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Something went wrong while clarifying your focus."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---------- generate CSC / gratitude / action / prayer ---------- */

  const handleGenerate = async (forceBible?: boolean) => {
    setError(null);
    setLoading(true);

    try {
      const entryText =
        confirmedFocus ||
        win ||
        focus ||
        building ||
        blocking ||
        "Today I am choosing my future self.";

      const useBible = forceBible ?? includeBible;

      const res = await fetch("/api/entries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: entryText,
          ageBucket: "adult_10plus",
          mode: "momentum",
          includeBible: useBible,
        }),
      });

      if (!res.ok) {
        throw new Error(`Generate API error ${res.status}`);
      }

      const data = (await res.json()) as CoachApiResponse;

      setCoachText((data.coach || "").toString().trim());

      // shape lines so they read like a strong “future-me” script
      const rawCSC = normalizeArray(data.csc);
      const rawGrateful = normalizeArray(data.gratefulList || data.grateful);
      const rawActions = normalizeArray(data.actionGuide || data.actions);
      const rawPrayers = normalizeArray(data.prayerList || data.prayers);

      const nextCSC = dedupeStrings(
        rawCSC.map((l) => forcePrefix(l, "I am"))
      );
      const nextGrateful = dedupeStrings(
        rawGrateful.map((l) => forcePrefix(l, "I am grateful for"))
      );
      const nextActions = dedupeStrings(
        rawActions.map((l) => forcePrefix(l, "Today I will"))
      );
      const nextPrayers = dedupeStrings(
        rawPrayers.map((l) => normalizePrayerLine(l))
      );

      setCscItems(nextCSC);
      setGratefulItems(nextGrateful);
      setActionItems(nextActions);
      setPrayerItems(nextPrayers);

      setQuote(data.quote ? String(data.quote) : null);

      if (data.bible && typeof data.bible === "object" && useBible) {
        setBible(data.bible as { text: string; ref: string });
      } else {
        setBible(null);
      }

      // reset choices & final popup
      setSelCSC(null);
      setSelGrateful(null);
      setSelAction(null);
      setSelPrayer(null);
      setShowFinal(false);
      setFinalScript("");

      setStep("coach");
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Something went wrong while generating your output."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---------- auto-build final script when all 4 choices selected ---------- */

  useEffect(() => {
    if (
      selCSC !== null &&
      selGrateful !== null &&
      selAction !== null &&
      selPrayer !== null &&
      !showFinal
    ) {
      const parts: string[] = [];

      if (cscItems[selCSC]) {
        parts.push(`CSC: ${cscItems[selCSC]}`);
      }
      if (gratefulItems[selGrateful]) {
        parts.push(`Grateful List: ${gratefulItems[selGrateful]}`);
      }
      if (actionItems[selAction]) {
        parts.push(`Action Guide: ${actionItems[selAction]}`);
      }
      if (prayerItems[selPrayer]) {
        parts.push(`Prayer List: ${prayerItems[selPrayer]}`);
      }

      if (quote) {
        parts.push(`CSC Quote: ${quote}`);
      }
      if (bible && includeBible) {
        parts.push(`Bible: ${bible.text} — ${bible.ref}`);
      }

      setFinalScript(parts.join("\n"));
      setShowFinal(true);
    }
  }, [
    selCSC,
    selGrateful,
    selAction,
    selPrayer,
    showFinal,
    cscItems,
    gratefulItems,
    actionItems,
    prayerItems,
    quote,
    bible,
    includeBible,
  ]);

  /* ---------- UI ---------- */

  return (
    <>
      <header>
        <div className="header-inner">
          <div className="header-left">
            <img
              src="/tfm_logo.png"
              alt="Today's Future Me"
              className="header-logo"
            />
            <div>
              <h1>Today&apos;s Future Me</h1>
              <p>Guided by Conscious Self Creation</p>
            </div>
          </div>
          <div className="header-right">
            <small suppressHydrationWarning>{todayString}</small>
          </div>
        </div>
      </header>

      <main>
        {error && (
          <section className="error-banner">
            <p>{error}</p>
          </section>
        )}

        {/* STEP 1: Entry cards */}
        {step === "entry" && (
          <>
            <section className="how-to-box">
              <h2>How to use</h2>
              <p>
                Choose one card below and write what&apos;s true for you today —
                what&apos;s blocking you, what you&apos;re focused on, what
                you&apos;re building, or today&apos;s win.
              </p>
              <p style={{ marginTop: "0.25rem" }}>
                Then click <strong>Continue</strong>. Today&apos;s Future Me
                will help you shape that into a clear path forward today.
              </p>
            </section>

            <section className="entry-grid">
              <div
                className={
                  "entry-card " + (focusSource === "blocking" ? "active" : "")
                }
                onClick={() => setFocusSource("blocking")}
              >
                <h2>BLOCKING</h2>
                <p className="helper-text">
                  What&apos;s dragging you down today? Be specific—what thought,
                  feeling, or situation is costing time, peace, or confidence?
                </p>
                <textarea
                  value={blocking}
                  onChange={(e) => setBlocking(e.target.value)}
                  placeholder="Write it out here..."
                />
              </div>

              <div
                className={
                  "entry-card " + (focusSource === "focus" ? "active" : "")
                }
                onClick={() => setFocusSource("focus")}
              >
                <h2>FOCUS</h2>
                <p className="helper-text">
                  What keeps looping in your head today—stealing focus or peace?
                  Be specific.
                </p>
                <textarea
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="Write it out here..."
                />
              </div>

              <div
                className={
                  "entry-card " + (focusSource === "building" ? "active" : "")
                }
                onClick={() => setFocusSource("building")}
              >
                <h2>BUILDING</h2>
                <p className="helper-text">
                  What&apos;s working well that you want to strengthen or
                  multiply?
                </p>
                <textarea
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  placeholder="Write it out here..."
                />
              </div>

              <div
                className={
                  "entry-card " + (focusSource === "win" ? "active" : "")
                }
                onClick={() => setFocusSource("win")}
              >
                <h2 style={{ fontSize: "0.9rem" }}>WIN</h2>
                <p className="helper-text">
                  What exact result do you want for today? Be measurable.
                </p>
                <textarea
                  value={win}
                  onChange={(e) => setWin(e.target.value)}
                  placeholder="Write it out here..."
                />
              </div>
            </section>

            <section className="settings-panel">
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  onClick={handleRestateFocus}
                >
                  Continue
                </button>
              </div>
            </section>
          </>
        )}

        {/* STEP 2: Confirm focus */}
        {step === "confirm" && (
          <section className="coach-block">
            {focusSource && (
              <h2 style={{ marginBottom: "0.35rem" }}>
                {SECTION_LABELS[focusSource]}
              </h2>
            )}

            {focusSource && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#9ca3af",
                  marginBottom: "0.6rem",
                }}
              >
                {CONFIRM_QUESTION[focusSource]}
              </p>
            )}

            {confirmedFocus && (
              <p style={{ fontWeight: 600, marginBottom: "0.4rem" }}>
                {confirmedFocus}
              </p>
            )}

            {focusExplanation && (
              <p style={{ fontSize: "0.85rem" }}>{focusExplanation}</p>
            )}

            <div
              className="button-row"
              style={{ marginTop: "1rem", justifyContent: "flex-start" }}
            >
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (confirmedFocus) {
                    setWin(confirmedFocus);
                  }
                  handleGenerate(includeBible);
                }}
              >
                Yes, keep this focus
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => setStep("entry")}
              >
                Back
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: Coach + choices + bible + quote */}
        {step === "coach" && (
          <>
            <section
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
              }}
            >
              <div className="button-row" style={{ marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setStep("confirm")}
                >
                  Back
                </button>

                <button
                  type="button"
                  className={`secondary toggle ${
                    includeBible ? "on" : ""
                  }`}
                  onClick={async () => {
                    const next = !includeBible;
                    setIncludeBible(next);
                    if (next) {
                      await handleGenerate(true); // refetch with bible
                    } else {
                      setBible(null);
                    }
                  }}
                >
                  {includeBible ? "Bible verse: ON" : "Bible verse: OFF"}
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    alert("History log will show past entries (coming soon).")
                  }
                >
                  History log
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    alert("Mini widget pin will be available in a later build.")
                  }
                >
                  Pin mini widget
                </button>
              </div>
            </section>

            {coachText && (
              <section className="coach-block">
                <h2 style={{ marginBottom: "0.35rem" }}>Coach</h2>
                <p>{coachText}</p>
              </section>
            )}

            <section className="output-card">
              <h3>CSC (I Am – Future You)</h3>
              <small className="helper-text">
                Three short “I am…” identity statements for who you are becoming
                today, based on your FOCUS, what&apos;s BLOCKING you, and
                what you&apos;re BUILDING.
              </small>
              <div
                className="choices-column"
                style={{ marginTop: "0.5rem" }}
              >
                {cscItems.slice(0, 3).map((line, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="choice-item"
                    data-selected={selCSC === idx}
                    onClick={() => handleChoiceSelect("csc", idx)}
                  >
                    {line}
                  </button>
                ))}
              </div>
            </section>

            <section className="output-card">
              <h3>Grateful List (Grateful For)</h3>
              <small className="helper-text">
                Three “I am grateful for…” statements that directly support your
                CSC “I am” identity and help you see the good inside today&apos;s
                challenges.
              </small>
              <div
                className="choices-column"
                style={{ marginTop: "0.5rem" }}
              >
                {gratefulItems.slice(0, 3).map((line, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="choice-item"
                    data-selected={selGrateful === idx}
                    onClick={() =>
                      handleChoiceSelect("grateful", idx)
                    }
                  >
                    {line}
                  </button>
                ))}
              </div>
            </section>

            <section className="output-card">
              <h3>Action Guide (I Will)</h3>
              <small className="helper-text">
                Three “Today I will…” actions that move you toward your CSC
                identity and are grounded in what you&apos;re grateful for
                today.
              </small>
              <div
                className="choices-column"
                style={{ marginTop: "0.5rem" }}
              >
                {actionItems.slice(0, 3).map((line, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="choice-item"
                    data-selected={selAction === idx}
                    onClick={() =>
                      handleChoiceSelect("action", idx)
                    }
                  >
                    {line}
                  </button>
                ))}
              </div>
            </section>

            <section className="output-card">
              <h3>Prayer List (Pray For)</h3>
              <small className="helper-text">
                Three short prayer intentions tying together today&apos;s CSC,
                gratitude, and actions — asking for guidance, strength, or
                clarity in very specific areas.
              </small>
              <div
                className="choices-column"
                style={{ marginTop: "0.5rem" }}
              >
                {prayerItems.slice(0, 3).map((line, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="choice-item"
                    data-selected={selPrayer === idx}
                    onClick={() =>
                      handleChoiceSelect("prayer", idx)
                    }
                  >
                    {line}
                  </button>
                ))}
              </div>
            </section>

            {/* Bible verse card between Prayer and Quote */}
            {bible && includeBible && (
              <section className="quote-block">
                <strong>Bible verse</strong>
                <p style={{ marginTop: "0.35rem" }}>
                  <em>{bible.text}</em>
                </p>
                <span className="ref">{bible.ref}</span>
              </section>
            )}

            {/* CSC quote card */}
            {quote &&
              (() => {
                let main = quote;
                let author = "";

                const parts = quote.split("—");
                if (parts.length >= 2) {
                  main = parts[0].trim();
                  author = parts.slice(1).join("—").trim();
                }

                return (
                  <section className="quote-block">
                    <strong>CSC Quote</strong>
                    <small
                      className="helper-text"
                      style={{
                        display: "block",
                        marginTop: "0.25rem",
                      }}
                    >
                      A short line of wisdom that reflects today&apos;s CSC,
                      gratitude, actions, and prayers — something you can
                      remember and repeat all day.
                    </small>
                    <p style={{ marginTop: "0.35rem" }}>
                      <em>{main}</em>
                    </p>
                    <span className="ref">
                      {author || "Source unknown (CSC coach prompt)."}
                    </span>
                  </section>
                );
              })()}
          </>
        )}
      </main>

      {/* Today’s Future Me Entry modal – appears after 4 choices picked */}
      {showFinal && finalScript && (
        <div className="tfm-loading-overlay">
          <div className="entry-modal-card">
            <img
              src="/tfm_logo.png"
              alt="TFM"
              className="entry-modal-logo"
            />
            <h2>Today&apos;s Future Me Entry</h2>
            <p
              style={{
                fontSize: "0.8rem",
                color: "#9ca3af",
                margin: "0.35rem 0 0.6rem",
              }}
            >
              This combines your CSC, gratitude, action, prayer, quote, and
              verse so you can pin it, log it, or record it.
            </p>

            <textarea
              readOnly
              value={finalScript}
              style={{
                width: "100%",
                minHeight: "7rem",
                borderRadius: "0.5rem",
                border: "1px solid #1f2937",
                padding: "0.6rem 0.7rem",
                backgroundColor: "#020617",
                fontSize: "0.85rem",
                whiteSpace: "pre-wrap",
              }}
            />

            <div className="button-row" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowFinal(false)}
              >
                Back
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() =>
                  alert("Pin widget will pin this entry on your device.")
                }
              >
                Pin widget
              </button>

              <button
                type="button"
                className="primary"
                onClick={() => {
                  // Save to simple local history and end session
                  try {
                    if (typeof window !== "undefined") {
                      const raw =
                        window.localStorage.getItem("tfm_history") ||
                        "[]";
                      const arr = JSON.parse(raw) as any[];
                      arr.push({
                        createdAt: new Date().toISOString(),
                        script: finalScript,
                      });
                      window.localStorage.setItem(
                        "tfm_history",
                        JSON.stringify(arr)
                      );
                    }
                  } catch {
                    // ignore storage errors
                  }
                  setShowFinal(false);
                  router.push("/");
                }}
              >
                Wrote in Journal, Log &amp; Close
              </button>

              <button
                type="button"
                className="primary"
                onClick={() => {
                  try {
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(
                        "tfm_script",
                        finalScript
                      );
                    }
                  } catch {
                    // ignore
                  }
                  setShowFinal(false);
                  router.push("/teleprompter");
                }}
              >
                Continue to record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay with spinning logo */}
      {loading && (
        <div className="tfm-loading-overlay">
          <img src="/tfm_logo.png" alt="" className="tfm-loading-logo" />
        </div>
      )}
    </>
  );
}
