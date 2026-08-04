import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
} from "@/lib/onboarding/server";

const uuidSchema = z.string().uuid();
const profileSchema = z
  .object({
    clearinghouse_registration_status: z.enum([
      "unknown",
      "registered",
      "not_registered",
    ]),
  })
  .strict();

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
          : "Unknown compliance-profile update failure",
      code: "COMPLIANCE_PROFILE_UPDATE_FAILED",
    },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clientId = uuidSchema.safeParse(id);
    if (!clientId.success) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const parsed = profileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid compliance profile.",
          code: "INVALID_COMPLIANCE_PROFILE",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { data: client, error: clientError } = await service
      .from("clients")
      .select("id, tier")
      .eq("id", clientId.data)
      .maybeSingle();
    if (clientError) {
      throw new Error(`Unable to verify the compliance client: ${clientError.message}`);
    }
    if (!client) {
      return NextResponse.json(
        { error: "Client not found", code: "CLIENT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const checkedAt =
      parsed.data.clearinghouse_registration_status === "unknown" ? null : now;
    const { data: profile, error: upsertError } = await service
      .from("client_compliance_profiles")
      .upsert(
        {
          client_id: clientId.data,
          clearinghouse_registration_status:
            parsed.data.clearinghouse_registration_status,
          clearinghouse_registration_checked_at: checkedAt,
          updated_at: now,
        },
        { onConflict: "client_id" }
      )
      .select(
        "id, client_id, clearinghouse_registration_status, clearinghouse_registration_checked_at, created_at, updated_at"
      )
      .single();
    if (upsertError || !profile) {
      throw new Error(
        `Unable to save the compliance profile: ${
          upsertError?.message ?? "row not returned"
        }`
      );
    }

    const { error: activityError } = await service.from("activity_log").insert({
      client_id: clientId.data,
      user_id: userId,
      action_type: "compliance_clearinghouse_registration_updated",
      entity_type: "client_compliance_profiles",
      entity_id: profile.id,
      description: "Clearinghouse registration status updated",
      metadata: {
        registration_status: profile.clearinghouse_registration_status,
        checked_at: profile.clearinghouse_registration_checked_at,
        client_tier: client.tier,
      },
    });
    if (activityError) {
      throw new Error(
        `Compliance profile ${profile.id} was saved, but activity logging failed: ${activityError.message}`
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    return failure(error);
  }
}
