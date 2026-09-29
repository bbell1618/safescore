import { NextResponse } from "next/server";
import { runDailySweep } from "@/lib/autopilot/sweep";
import { queueReportCards, runWeeklyAutopilot } from "@/lib/autopilot/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isMondayPacific(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now) === "Mon";
}

/** Daily: turn finished work into cards. Mondays: weekly check-ins + Daven summary. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sweep = await runDailySweep();
    const reports = await queueReportCards();
    const weekly = isMondayPacific() ? await runWeeklyAutopilot() : null;
    return NextResponse.json({ sweep, reportCardsQueued: reports, weekly });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
