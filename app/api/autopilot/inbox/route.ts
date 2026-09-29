import { NextResponse } from "next/server";
import { loadInbox } from "@/lib/autopilot/inbox-server";
import { requireStaffUserId } from "@/lib/autopilot/staff";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await requireStaffUserId();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await loadInbox());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
