import { NextResponse } from "next/server";
import { requireStaffUserId } from "@/lib/autopilot/staff";
import { queueReportCards, runWeeklyAutopilot } from "@/lib/autopilot/weekly";
import { runDailySweep } from "@/lib/autopilot/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Staff can run this week's pass on demand (same logic as the Monday cron). */
export async function POST(request: Request) {
  const userId = await requireStaffUserId();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { clientId?: string };
  try {
    const weekly = await runWeeklyAutopilot({ onlyClientId: body.clientId });
    const reports = body.clientId ? 0 : await queueReportCards();
    const sweep = body.clientId ? null : await runDailySweep();
    return NextResponse.json({ weekly, reportCardsQueued: reports, sweep });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
