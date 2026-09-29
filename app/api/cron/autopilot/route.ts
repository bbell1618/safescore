import { NextResponse } from "next/server";
import { queueReportCards, runWeeklyAutopilot } from "@/lib/autopilot/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Monday morning: queue each carrier's weekly check-in and Daven's summary. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const weekly = await runWeeklyAutopilot();
    const reports = await queueReportCards();
    return NextResponse.json({ weekly, reportCardsQueued: reports });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
