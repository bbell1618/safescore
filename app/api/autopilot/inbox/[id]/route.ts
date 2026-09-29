import { NextResponse } from "next/server";
import { approveCard, DecisionError, rejectCard } from "@/lib/autopilot/decide";
import { answerCard } from "@/lib/autopilot/answer";
import { requireStaffUserId } from "@/lib/autopilot/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  action?: "approve" | "reject" | "answer";
  subject?: string;
  bodyText?: string;
  toAddress?: string;
  cc?: string | null;
  note?: string;
  value?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireStaffUserId();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  try {
    if (body.action === "approve") {
      return NextResponse.json(await approveCard(id, userId, body));
    }
    if (body.action === "reject") {
      return NextResponse.json(await rejectCard(id, userId, body.note ?? null));
    }
    if (body.action === "answer") {
      return NextResponse.json(await answerCard(id, userId, body.value ?? ""));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const status = error instanceof DecisionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
