import { NextResponse } from "next/server";
import { requestLoginCode } from "@/lib/auth/login-code";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await requestLoginCode((body as { email?: unknown }).email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, dryRun: result.dryRun === true });
}
