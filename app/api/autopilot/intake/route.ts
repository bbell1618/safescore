import { NextResponse } from "next/server";
import { runDotIntake } from "@/lib/autopilot/intake";
import { requireStaffUserId } from "@/lib/autopilot/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const userId = await requireStaffUserId();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { dot?: unknown; email?: unknown } | null;
  try {
    const result = await runDotIntake(body?.dot, { email: typeof body?.email === "string" ? body.email : null });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
