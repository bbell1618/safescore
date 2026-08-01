import {
  OnboardingRouteFailure,
  requirePortalOnboardingClient,
  transitionFailure,
} from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const { service, userId, clientId } =
      await requirePortalOnboardingClient();
    const { data, error } = await service
      .rpc("submit_assessment_activation_v1", {
        p_client_id: clientId,
        p_user_id: userId,
      })
      .single();
    if (error || !data) {
      throw transitionFailure(error, "Assessment activation was not submitted");
    }
    const result = data as {
      result_status: string;
      result_tier: string;
      already_submitted: boolean;
    };

    return NextResponse.json({
      success: true,
      status: result.result_status,
      tier: result.result_tier,
      alreadySubmitted: result.already_submitted,
      nextPath: "/onboarding",
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const message =
      error instanceof Error ? error.message : "Unknown assessment activation failure";
    return NextResponse.json(
      { error: message, code: "ASSESSMENT_ACTIVATION_FAILED" },
      { status: 500 }
    );
  }
}
