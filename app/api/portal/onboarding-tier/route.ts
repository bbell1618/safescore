import { isClientTier } from "@/lib/tiers";
import {
  OnboardingRouteFailure,
  requirePortalOnboardingClient,
  transitionFailure,
} from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { tier?: unknown }
      | null;
    if (!body || !isClientTier(body.tier)) {
      return NextResponse.json(
        { error: "Choose a valid SafeScore service tier.", code: "INVALID_CLIENT_TIER" },
        { status: 400 }
      );
    }

    const { service, userId, clientId } =
      await requirePortalOnboardingClient();
    const { data, error } = await service
      .rpc("change_client_onboarding_tier_v1", {
        p_client_id: clientId,
        p_user_id: userId,
        p_selected_tier: body.tier,
      })
      .single();
    if (error || !data) {
      throw transitionFailure(error, "The service tier was not changed");
    }
    const result = data as {
      result_tier: string;
      original_assigned_tier: string;
      previous_tier: string;
      changed: boolean;
    };

    return NextResponse.json({
      success: true,
      tier: result.result_tier,
      assignedTier: result.original_assigned_tier,
      previousTier: result.previous_tier,
      changed: result.changed,
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown tier-change failure";
    return NextResponse.json({ error: message, code: "TIER_CHANGE_FAILED" }, { status: 500 });
  }
}
