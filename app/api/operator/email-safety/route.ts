import { NextResponse } from "next/server";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

// A read-only runtime check. Never return environment values or send an email.
export async function GET() {
  try {
    await requireStaffOnboardingUser();
    return NextResponse.json(
      { emailDryRunExactlyTrue: process.env.EMAIL_DRY_RUN === "true" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown email safety check failure",
        code: error instanceof OnboardingRouteFailure ? error.code : "EMAIL_SAFETY_CHECK_FAILED",
      },
      {
        status: error instanceof OnboardingRouteFailure ? error.status : 500,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }
}
