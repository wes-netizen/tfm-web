// pages/api/entries/generate.ts
import type { NextApiRequest, NextApiResponse } from "next";

/** Mini “learning-like” generator:
 *  - Classifies theme from input
 *  - Produces CSC, Gratitude, Actions, Prayers
 *  - Aligns verse + quote by theme
 *  - Supports { want: { coach | csc | grateful | actions | prayers | bible | quote } }
 */

type Want = {
  csc?: boolean; grateful?: boolean; actions?: boolean; prayers?: boolean;
  quote?: boolean; bible?: boolean; coach?: boolean;
};
type Plan = {
  theme: keyof typeof THEMES;
  outcome: string;
  metric: string;
  byWhen: string;
  blocker: string;
  antiBlocker: string;
  actors: string[];
};

const THEMES = {
  consistency: {
    verse: { text: "Let us not become weary in doing good...", ref: "Galatians 6:9" },
    quotes: [
      "Success is the product of daily consistency, not occasional intensity.",
      "Small disciplines repeated with consistency lead to great achievements.",
    ],
  },
  launch: {
    verse: { text: "Commit to the LORD whatever you do, and he will establish your plans.", ref: "Proverbs 16:3" },
    quotes: [
      "Done is better than perfect.",
      "Ships are safest in harbor—but that’s not what ships are for.",
    ],
  },
  focus: {
    verse: { text: "Be still, and know that I am God.", ref: "Psalm 46:10" },
    quotes: [
      "Where focus goes, energy flows.",
      "The successful warrior is the average person with laser-like focus.",
    ],
  },
  team: {
    verse: { text: "Two are better than one, because they have a good return for their labor.", ref: "Ecclesiastes 4:9" },
    quotes: [
      "If you want to go fast, go alone. If you want to go far, go together.",
      "Trust is built in consistent, small moments.",
    ],
  },
  sales: {
    verse: { text: "Let your yes be yes and your no be no.", ref: "Matthew 5:37" },
    quotes: [
      "Pipeline is the oxygen of growth.",
      "Clarity sells. Confusion repels.",
    ],
  },
  courage: {
    verse: { text: "Be strong and courageous; do not be afraid.", ref: "Joshua 1:9" },
    quotes: [
      "Courage is not the absence of fear, but the triumph over it.",
      "Do the thing you fear and the death of fear is certain.",
    ],
  },
} as const;

function classifyTheme(s: string): keyof typeof THEMES {
  const k = s.toLowerCase();
  if (/(launch|ship|publish|release|store|app)/.test(k)) return "launch";
  if (/(team|people|meeting|alignment|communication|huddle|hire)/.test(k)) return "team";
  if (/(sale|pipeline|lead|deal|quote|proposal|close)/.test(k)) return "sales";
  if (/(focus|clarity|distract|overwhelm|anxiety)/.test(k)) return "focus";
  if (/(courage|fear|doubt|confidence|bold)/.test(k)) return "courage";
  return "consistency";
}
function extractActors(s: string): string[] {
  const hits = Array.from(new Set((s.match(/\b(alex|katie|zach|client|team|designer|dev|qa|marketing|ops)\b/gi) || [])
    .map(x => x[0].toUpperCase() + x.slice(1).toLowerCase())));
  return hits.length ? hits : ["You"];
}
function extractByWhen(s: string): string {
  const k = s.toLowerCase();
  if (/\btoday\b/.test(k)) return "by end of today";
  if (/\bthis week\b/.test(k)) return "by end of this week";
  if (/\btomorrow\b/.test(k)) return "by tomorrow";
  if (/\bfriday\b/.test(k)) return "by Friday";
  return "within 24–48 hours";
}
function extractOutcome(s: string): string {
  const k = s.toLowerCase();
  if (/(launch|store|app|submit)/.test(k)) return "ship a stable build and submit store materials";
  if (/(meeting|alignment|agenda)/.test(k)) return "align the team on a single-page plan and next actions";
  if (/(pipeline|leads|deals|prospect)/.test(k)) return "advance three qualified deals to the next stage";
  if (/(content|post|marketing)/.test(k)) return "publish two useful posts with a clear CTA";
  return "finish one meaningful milestone that moves the goal forward";
}
function guessBlocker(s: string): string {
  const k = s.toLowerCase();
  if (/(overwhelm|too much|many)/.test(k)) return "overwhelm and context switching";
  if (/(doubt|fear|confidence)/.test(k)) return "hesitation from doubt";
  if (/(waiting|dependency|approval)/.test(k)) return "blocked dependency";
  return "ambiguous next step";
}
function antiBlockerFor(b: string): string {
  if (/overwhelm/.test(b)) return "timebox 25m on the single top task (close all else)";
  if (/doubt/.test(b)) return "start with a 10-minute draft to build proof and momentum";
  if (/dependency/.test(b)) return "send one clear message with a deadline and fallback path";
  return "define outcome + first 10-minute action";
}
function metricFor(s: string): string {
  const k = s.toLowerCase();
  if (/(launch|ship|submit)/.test(k)) return "build passes smoke test; submission complete";
  if (/(deal|lead|pipeline)/.test(k)) return "3 deals advanced; notes updated";
  if (/(content|post)/.test(k)) return "2 posts live; CTR measured";
  if (/(align|meeting)/.test(k)) return "one-page plan shared; owners + due dates set";
  return "milestone done and documented";
}
function planFrom(input: string): Plan {
  const theme = classifyTheme(input);
  const byWhen = extractByWhen(input);
  const outcome = extractOutcome(input);
  const actors = extractActors(input);
  const blocker = guessBlocker(input);
  return {
    theme,
    outcome,
    metric: metricFor(input),
    byWhen,
    blocker,
    antiBlocker: antiBlockerFor(blocker),
    actors,
  };
}

/* ---------- Builders ---------- */
function buildCSC(p: Plan) {
  return [
    `I am the person who finishes ${p.outcome} ${p.byWhen}.`,
    `I practice consistency: ${p.antiBlocker}.`,
    `I create evidence today: ${p.metric}.`,
  ];
}
function buildGrateful(p: Plan) {
  const who = p.actors.slice(0,2).join(" & ") || "my team";
  return [
    `I am grateful for the strengths that make ${p.theme} possible (focus, honesty, follow-through).`,
    `I am grateful for support from ${who}.`,
    `I am grateful for lessons pressure teaches while we finish ${p.outcome}.`,
  ];
}
function buildActions(p: Plan) {
  return [
    `10 minutes: Define the exact “done” for ${p.outcome} and list 3 checks for ${p.metric}.`,
    `60 minutes: Timebox work; ${p.antiBlocker}. Capture decisions.`,
    `Today: Unblock one dependency (ping owner with deadline + fallback).`,
  ];
}
function buildPrayers(p: Plan) {
  return [
    `Pray for clarity and courage to finish ${p.outcome} ${p.byWhen}.`,
    `Pray for patience and steady energy while we ${p.theme}.`,
    `Pray for wisdom to resolve blockers: ${p.blocker}.`,
  ];
}
function pickQuote(theme: keyof typeof THEMES) {
  const arr = THEMES[theme].quotes;
  return arr[(Math.random() * arr.length) | 0];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body || {}) as {
    focus?: string; friction?: string; want?: Want;
  };
  const want = body.want || {};
  const focus = (body.focus || body.friction || "today").toString().trim();

  const p = planFrom(focus);
  if (want.coach) {
    return res.status(200).json({ coach: `Good. Will you commit to ${p.outcome} ${p.byWhen}?` });
  }

  const out: Record<string, unknown> = {};
  if (want.csc) out.csc = buildCSC(p);
  if (want.grateful) out.grateful = buildGrateful(p);
  if (want.actions) out.actions = buildActions(p);
  if (want.prayers) out.prayers = buildPrayers(p);
  if (want.bible) out.bible = THEMES[p.theme].verse;
  if (want.quote) out.quote = pickQuote(p.theme);

  if (want.csc || want.grateful || want.actions || want.prayers || want.quote) {
    const raw = [
      "CSC", ...(out.csc as string[] || []).map(s => `- ${s}`),
      "Grateful", ...(out.grateful as string[] || []).map(s => `- ${s}`),
      "Action", ...(out.actions as string[] || []).map(s => `- ${s}`),
      "Prayer", ...(out.prayers as string[] || []).map(s => `- ${s}`),
      "Quote", (out.quote as string) || "",
    ].join("\n");
    out.raw = raw;
  }
  return res.status(200).json(out);
}