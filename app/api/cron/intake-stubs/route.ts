import { NextResponse } from "next/server";
import { processGoldenDeskStubs } from "@/lib/autopilot/gd-stubs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every minute: finish carriers added from GoldenDesk (lookup, FMCSA pull, plan, approval card). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ processed: await processGoldenDeskStubs() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
