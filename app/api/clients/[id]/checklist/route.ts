import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";
import { getClientChecklist } from "@/lib/operator/checklist-server";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

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
        error instanceof Error
          ? error.message
          : "Unknown checklist loading failure",
      code: "CHECKLIST_LOAD_FAILED",
    },
    { status: 500 }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedClientId = uuidSchema.safeParse((await params).id);
    if (!parsedClientId.success) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }
    const { service } = await requireStaffOnboardingUser();
    const payload = await getClientChecklist(parsedClientId.data, { service });
    return NextResponse.json(payload);
  } catch (error) {
    return failure(error);
  }
}
