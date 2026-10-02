import { NextResponse } from "next/server";
import { requireStaffUserId } from "@/lib/autopilot/staff";
import { getTermsApproval, recordTermsApproval } from "@/lib/legal/approval-server";

export const dynamic = "force-dynamic";

const OWNER_NAME = "daven loomba";

/** Records the owner's approval of the current terms and sign-card wording. */
export async function POST(request: Request) {
  const userId = await requireStaffUserId();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; confirm?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (name.toLowerCase() !== OWNER_NAME) {
    return NextResponse.json({ error: "Only Daven Loomba can approve these terms. Type his full name exactly." }, { status: 400 });
  }
  if (body.confirm !== true) return NextResponse.json({ error: "Check the box to approve." }, { status: 400 });
  try {
    const existing = await getTermsApproval();
    if (existing) return NextResponse.json({ approval: existing });
    return NextResponse.json({ approval: await recordTermsApproval("Daven Loomba", userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
