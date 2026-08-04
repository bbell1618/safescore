import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
  transitionFailure,
} from "@/lib/onboarding/server";
import { runPostActivationInitialization } from "@/lib/activation/post-activation-server";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 300;

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const { data, error } = await service
      .rpc("activate_assessment_client_v1", {
        p_client_id: id,
        p_user_id: userId,
      })
      .single();
    if (error || !data) {
      throw transitionFailure(error, "The client Assessment was not activated");
    }
    const result = data as {
      result_status: string;
      result_tier: string;
      already_active: boolean;
    };
    const initialization = await runPostActivationInitialization(service, {
      clientId: id,
      tier: "assessment",
      source: "staff_activation",
      newlyActivated: result.already_active !== true,
      actorUserId: userId,
    });
    if (initialization.status === "in_progress") {
      throw new Error(
        "Another activation initialization is still running. Retry after it finishes."
      );
    }

    return NextResponse.json({
      success: true,
      status: result.result_status,
      tier: result.result_tier,
      alreadyActive: result.already_active,
      initialization,
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown activation failure";
    return NextResponse.json(
      { error: message, code: "CLIENT_ACTIVATION_FAILED" },
      { status: 500 }
    );
  }
}
