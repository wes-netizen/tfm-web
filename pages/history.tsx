// pages/history.tsx
import { useEffect, useState } from "react";
import Link from "next/link";

type Entry = {
  id: string;
  createdAt: string;
  script: string | null;
  coachText: string | null;
  quote: string | null;
};

export default function HistoryPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/entries/history");
        const json = await res.json();

        if (json.error) {
          setError(json.error);
        }
        if (json.detail) {
          setDetail(json.detail);
        }

        setEntries(json.entries || []);
      } catch (e: any) {
        console.error(e);
        setError("Failed to load history.");
        setDetail(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 p-4">
        <p>Loading history…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 p-4 space-y-4">

      {/* ← Back Button */}
      <div>
        <Link
          href="/"
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          ← Back to Today
        </Link>
      </div>

      <h1 className="text-xl font-semibold">
        Today&apos;s Future Me — History
      </h1>

      {error && (
        <div className="text-xs text-rose-300 space-y-1">
          <p>{error}</p>
          {detail && <p className="text-[10px] text-rose-400/70">{detail}</p>}
        </div>
      )}

      {entries.length === 0 && !error && (
        <p className="text-sm text-slate-400">
          No entries found yet. Complete a Today&apos;s Future Me session and
          tap <strong>Wrote in Journal, Log &amp; Close</strong> to see it here.
        </p>
      )}

      <div className="space-y-3">
        {entries.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm"
          >
            <div className="text-xs text-slate-400 mb-1">
              {new Date(e.createdAt).toLocaleString()}
            </div>

            {e.coachText && (
              <p className="text-xs mb-2 text-emerald-300">{e.coachText}</p>
            )}

            {e.script && (
              <pre className="whitespace-pre-wrap text-xs text-slate-100">
                {e.script}
              </pre>
            )}

            {e.quote && (
              <p className="mt-2 text-[11px] italic text-slate-300">
                {e.quote}
              </p>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
