import { NextResponse } from "next/server";
import { verifyLoginCode } from "@/lib/auth/login-code";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  const result = await verifyLoginCode(body.email, body.code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  return NextResponse.json({ success: true, nextPath: result.nextPath });
}
