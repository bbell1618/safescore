import { NextResponse } from "next/server";
import { processGoldenDeskStubs } from "@/lib/autopilot/gd-stubs";
import { createHandoffTasks } from "@/lib/autopilot/handoff";
import { processSetupNudgeRequests } from "@/lib/autopilot/setup-nudge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every minute: finish carriers added from GoldenDesk (lookup, FMCSA pull, plan, approval card), hand off carriers that finished onboarding, and write requested setup-list emails. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const processed = await processGoldenDeskStubs();
    const handoffs = await createHandoffTasks().catch((error) => {
      console.error(`[intake-stubs] hand-off failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    // QF-223: "Ask them to finish" requests from GoldenDesk become approval cards here.
    const setupEmails = await processSetupNudgeRequests().catch((error) => {
      console.error(`[intake-stubs] setup emails failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    return NextResponse.json({ processed, handoffs, setupEmails });
  } catch (error) {
    console.error(`[intake-stubs] failed: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
