import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

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
          : "Unknown alert acknowledgement failure",
      code: "ALERT_ACKNOWLEDGEMENT_FAILED",
    },
    { status: 500 }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedId = uuidSchema.safeParse((await params).id);
    if (!parsedId.success) {
      return NextResponse.json(
        { error: "A valid alert ID is required.", code: "INVALID_ALERT_ID" },
        { status: 400 }
      );
    }
    const { service, userId } = await requireStaffOnboardingUser();
    const { data: existing, error: existingError } = await service
      .from("alerts")
      .select("id, acknowledged_at, acknowledged_by")
      .eq("id", parsedId.data)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Unable to load alert: ${existingError.message}`);
    }
    if (!existing) {
      return NextResponse.json(
        { error: "Alert not found.", code: "ALERT_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (existing.acknowledged_at) {
      return NextResponse.json(
        {
          error: "This alert has already been acknowledged.",
          code: "ALERT_ALREADY_ACKNOWLEDGED",
        },
        { status: 409 }
      );
    }

    const acknowledgedAt = new Date().toISOString();
    const { data: alert, error: updateError } = await service
      .from("alerts")
      .update({
        acknowledged_at: acknowledgedAt,
        acknowledged_by: userId,
      })
      .eq("id", parsedId.data)
      .is("acknowledged_at", null)
      .select("id, client_id, acknowledged_at, acknowledged_by")
      .maybeSingle();
    if (updateError) {
      throw new Error(`Unable to acknowledge alert: ${updateError.message}`);
    }
    if (!alert) {
      return NextResponse.json(
        {
          error: "The alert changed before acknowledgement completed. Reload and try again.",
          code: "ALERT_ACKNOWLEDGEMENT_CONFLICT",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ alert });
  } catch (error) {
    return failure(error);
  }
}
