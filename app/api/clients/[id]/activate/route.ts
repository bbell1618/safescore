import {
  OnboardingRouteFailure,
  requireStaffOnboardingUser,
  transitionFailure,
} from "@/lib/onboarding/server";
import { runPostActivationInitialization } from "@/lib/activation/post-activation-server";
import type { ClientTier } from "@/lib/supabase/types";
import { isClientTier } from "@/lib/tiers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

type ActivationTransition = {
  result_status: string;
  result_tier: ClientTier;
  already_active: boolean;
  mrr: number | null;
};

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maxDuration = 300;

function routeFailure(message: string, status: number, code: string): never {
  throw new OnboardingRouteFailure(message, status, code);
}

async function activateAssessment(
  service: SupabaseClient,
  clientId: string,
  userId: string
): Promise<ActivationTransition> {
  const { data, error } = await service
    .rpc("activate_assessment_client_v1", {
      p_client_id: clientId,
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
  return {
    result_status: result.result_status,
    result_tier: "assessment",
    already_active: result.already_active,
    mrr: null,
  };
}

/**
 * The RPC owns the complete recurring transition so the local subscription,
 * client status, activation intent trigger, and audit row commit together.
 * It rejects Stripe-linked subscriptions and never accepts Stripe identifiers.
 */
async function activateStaffConfirmedSubscription(
  service: SupabaseClient,
  clientId: string,
  userId: string
): Promise<ActivationTransition> {
  const { data, error } = await service
    .rpc("activate_staff_confirmed_subscription_v1", {
      p_client_id: clientId,
      p_user_id: userId,
    })
    .single();
  if (error || !data) {
    throw transitionFailure(
      error,
      "The staff-confirmed subscription was not activated"
    );
  }
  const result = data as {
    result_status: string;
    result_tier: string;
    already_active: boolean;
    result_mrr: number | string | null;
  };
  if (!isClientTier(result.result_tier) || result.result_tier === "assessment") {
    throw new Error(
      "Staff subscription activation returned an invalid service tier"
    );
  }
  const mrr =
    result.result_mrr === null ? null : Number(result.result_mrr);
  if (mrr !== null && !Number.isFinite(mrr)) {
    throw new Error("Staff subscription activation returned an invalid MRR");
  }
  return {
    result_status: result.result_status,
    result_tier: result.result_tier,
    already_active: result.already_active,
    mrr,
  };
}

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!CLIENT_ID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "A valid client ID is required.", code: "INVALID_CLIENT_ID" },
        { status: 400 }
      );
    }

    const { service, userId } = await requireStaffOnboardingUser();
    const { data: client, error: clientError } = await service
      .from("clients")
      .select("id, tier")
      .eq("id", id)
      .maybeSingle();
    if (clientError) {
      throw new Error(
        `Unable to load client for activation: ${clientError.message}`
      );
    }
    if (!client) {
      routeFailure("Client not found.", 404, "CLIENT_NOT_FOUND");
    }
    if (!isClientTier(client.tier)) {
      routeFailure(
        "Assign a SafeScore service tier before activation.",
        409,
        "CLIENT_TIER_REQUIRED"
      );
    }

    const result =
      client.tier === "assessment"
        ? await activateAssessment(service, id, userId)
        : await activateStaffConfirmedSubscription(service, id, userId);
    const initialization = await runPostActivationInitialization(service, {
      clientId: id,
      tier: result.result_tier,
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
      mrr: result.mrr,
      initialization,
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const message =
      error instanceof Error ? error.message : "Unknown activation failure";
    return NextResponse.json(
      { error: message, code: "CLIENT_ACTIVATION_FAILED" },
      { status: 500 }
    );
  }
}
