// pages/api/entries/focus.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type FocusResponse = {
  focusLine: string;
  explanation: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { entry } = req.body as { entry?: string };

  if (!entry || !entry.trim()) {
    return res.status(400).json({ error: "Missing entry text." });
  }

  const prompt = `
You help people clarify one clear focus for today.

User text:
"""
${entry.trim()}
"""

Write JSON only, no backticks, with this exact shape:

{
  "focusLine": "short, specific sentence in first person, present tense",
  "explanation": "one short paragraph (2–4 sentences) explaining why this focus matters today"
}

Rules:
- Write at a 4th–5th grade reading level.
- "focusLine" must be 1 sentence, starting with "I am" or "Today I will".
- Use the user's own ideas and language where possible.
- "explanation" should sound like an encouraging reminder, not coach instructions.
`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise focus-clarifying assistant for the Today's Future Me app.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as FocusResponse;

    return res.status(200).json({
      focusLine: parsed.focusLine || "",
      explanation: parsed.explanation || "",
    });
  } catch (err: any) {
    console.error("focus restate error:", err);
    return res.status(500).json({
      error: "Failed to restate focus",
      detail: err?.message || String(err),
    });
  }
}
