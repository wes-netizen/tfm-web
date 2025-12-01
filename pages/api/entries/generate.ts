// pages/api/entries/generate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { TFM_CSC_COACH_PROMPT } from "../../../lib/tfmCscCoachPrompt";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type GenerateBody = {
  entry?: string;
  focusSection?: "blocking" | "focus" | "building" | "win";
  ageBucket?: string;
  mode?: string;
  includeBible?: boolean;
};

type GenerateResponse = {
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
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not set on the server." });
  }

  const body = (req.body || {}) as GenerateBody;
  const entry = (body.entry || "").trim();
  const includeBible = Boolean(body.includeBible);

  if (!entry) {
    return res.status(400).json({ error: "Missing entry text." });
  }

  const mode = body.mode || "momentum";

  const bibleInstruction = includeBible
    ? `The user has requested a Bible verse. You MUST fill "bible" with a short verse and reference that clearly supports today's CSC, gratitude, actions, and prayers.`
    : `The user did not specifically request a Bible verse. You may set "bible" to null, or choose a short verse and reference that gently supports today's themes.`;

  const prompt = `
You are helping a user of the "Today's Future Me" app create a short, clear daily script.

The entry below is their full journaling for today. It may include sections like FOCUS, BLOCKING, WINS / BUILDING, ACTIONS, and PRAYERS. Treat it as the single source of truth for what matters today.

User's entry:
"""
${entry}
"""

Write **JSON only** (no backticks) with this exact shape:

{
  "coach": "one short encouragement paragraph",
  "csc": ["I am ...", "I am ...", "I am ..."],
  "gratefulList": ["I am grateful for ...", "I am grateful for ...", "I am grateful for ..."],
  "actionGuide": ["Today I will ...", "Today I will ...", "Today I will ..."],
  "prayerList": ["I pray for ...", "I pray for ...", "I pray for ..."],
  "quote": "short one- or two-sentence quote that fits the whole day",
  "bible": { "text": "verse text", "ref": "Book 0:0" } OR null
}

MODE:
- The tone should match mode "${mode}".
- Example: "momentum" = hopeful, forward-moving; "pastoral" = calm, gentle; "coach" = direct, encouraging.

DETAILED RULES (very important):

1) COACH PARAGRAPH ("coach")
- 2–3 short sentences.
- Speak directly to the user and what they wrote today.
- End with this exact final sentence: "Consciously creating your future self."

2) CSC ("csc")
- EXACTLY 3 lines.
- Each MUST start with "I am ".
- 8–16 words per line.
- Identity statements about who the user is becoming TODAY, based on their entry.
- Directly reflect their FOCUS, what is BLOCKING them, and what they are BUILDING or WINNING at.
- No generic fluff like "I am amazing" — use the real details and themes from the entry.

3) GRATEFUL LIST ("gratefulList")
- EXACTLY 3 lines.
- Each MUST start with "I am grateful for ".
- 8–18 words per line.
- Each line should consciously SUPPORT or REINFORCE one of the CSC "I am" identities.
- Use specific people, opportunities, lessons, resources, or growth that appear (or are implied) in the entry.

4) ACTION GUIDE ("actionGuide")
- EXACTLY 3 lines.
- Each MUST start with "Today I will ".
- 10–20 words per line.
- Realistic actions that can be taken TODAY.
- Each action must move the user toward at least one CSC identity and be connected, where possible, to something they are grateful for.

5) PRAYER LIST ("prayerList")
- EXACTLY 3 lines.
- Each MUST start with "I pray for " or "I'm praying for ".
- 10–20 words per line.
- Gently tie together CSC, gratitude, and actions: asking for help, guidance, courage, peace, or clarity in specific areas.
- Warm, grounded, non-extreme spiritual tone (non-denominational, respectful).

6) CSC COACH QUOTE ("quote")
- ONE quote only.
- 1–2 sentences total, 15–28 words.
- Should feel like a sticky line of wisdom that captures today's CSC, gratitude, actions, and prayers all together.
- Avoid clichés like "never give up" unless they are clearly grounded in this specific entry.

7) BIBLE VERSE ("bible")
- ${bibleInstruction}

GLOBAL STYLE:
- Aim for a 4th–5th grade reading level for CSC, gratitude, actions, and prayers. The quote and Bible verse may be slightly more advanced.
- Keep language short, concrete, and specific to THIS user and THIS day.

Remember: output **must** be valid JSON that exactly matches the structure above. Do not add any extra fields or comments.
`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5.1",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: TFM_CSC_COACH_PROMPT,
        },
        {
          role: "user",
          content: prompt, // your existing JSON instructions + bibleInstruction, etc.
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as GenerateResponse;

    // Bible logic: respect includeBible, but tolerate null from the model.
    const bible =
      includeBible && parsed.bible
        ? parsed.bible
        : includeBible
        ? parsed.bible || null
        : null;

    const out: GenerateResponse = {
      coach: parsed.coach || "",
      csc: parsed.csc || [],
      grateful: parsed.grateful || undefined,
      gratefulList: parsed.gratefulList || parsed.grateful || [],
      actions: parsed.actions || undefined,
      actionGuide: parsed.actionGuide || [],
      prayers: parsed.prayers || undefined,
      prayerList: parsed.prayerList || [],
      quote: parsed.quote || "",
      bible,
    };

    return res.status(200).json(out);
  } catch (err: any) {
    console.error("generate error:", err);
    return res.status(500).json({
      error: "Failed to generate entry",
      detail: err?.message || String(err),
    });
  }
}
