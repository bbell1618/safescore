import { NextResponse } from "next/server";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";
import { getOperatorToday } from "@/lib/operator/checklist-server";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof OnboardingRouteFailure) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Unknown Today loading failure",
      code: "OPERATOR_TODAY_LOAD_FAILED",
    },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const { service } = await requireStaffOnboardingUser();
    return NextResponse.json(await getOperatorToday({ service }));
  } catch (error) {
    return failure(error);
  }
}
