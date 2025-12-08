// pages/api/entries/history.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // TEMP for beta: return ALL journal entries, newest first.
    // This ignores userId so we can confirm entries are being logged.
    const entries = await prisma.journalEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        script: true,
        coachText: true,
        quote: true,
        // optional: see which user they belong to
        userId: true,
        source: true,
      },
    });

    return res.status(200).json({ entries });
  } catch (err: any) {
    console.error("History error:", err);
    return res.status(500).json({
      entries: [],
      error: "Failed to load history",
      detail: err?.message || String(err),
    });
  }
}

