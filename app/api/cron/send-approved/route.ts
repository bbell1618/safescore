import { NextResponse } from "next/server";
import { sendApprovedCards } from "@/lib/autopilot/send-approved";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** QF-198: every minute (QF-215), send what was approved in GoldenDesk. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendApprovedCards());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
