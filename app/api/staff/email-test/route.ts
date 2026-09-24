import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffOnboardingUser, OnboardingRouteFailure } from "@/lib/onboarding/server";
import { sendStaffTestEmail } from "@/lib/email/client";
import { STAFF_TEST_RECIPIENTS } from "@/lib/email/staff-test-policy";

const schema = z.object({ to: z.enum(STAFF_TEST_RECIPIENTS) }).strict();

export async function POST(request: Request) {
  try {
    // Middleware requires authentication; the route independently enforces staff role.
    await requireStaffOnboardingUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "Cross-origin email test is forbidden" }, { status: 403 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const result = await sendStaffTestEmail(parsed.data.to);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 502 });
    if (!result.messageId) return NextResponse.json({ error: "Email transport returned no message ID" }, { status: 502 });
    return NextResponse.json(result.dryRun
      ? { mode: "dry_run", outboxId: result.messageId }
      : { mode: "smtp", messageId: result.messageId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: error instanceof OnboardingRouteFailure ? error.status : error instanceof SyntaxError ? 400 : 500,
    });
  }
}
