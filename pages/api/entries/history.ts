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
    const userId =
      (req as any).user?.id ||
      (req as any).session?.user?.id ||
      "anonymous";

    const entries = await prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        script: true,
        coachText: true,
        quote: true,
      },
    });

    return res.status(200).json({ entries });
  } catch (err: any) {
    console.error("History error:", err);

    // Don’t throw a 500 at the UI – return empty list with error info
    return res.status(200).json({
      entries: [],
      error: "Failed to load history",
      detail: err?.message || String(err),
    });
  }
}
