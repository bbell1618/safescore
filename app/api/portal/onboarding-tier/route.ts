import { isClientTier, tierDisplayLabel } from "@/lib/tiers";
import {
  OnboardingRouteFailure,
  requirePortalOnboardingClient,
  transitionFailure,
} from "@/lib/onboarding/server";
import { notifyOperations } from "@/lib/notifications/operations";
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
    if (
      !isClientTier(result.result_tier) ||
      !isClientTier(result.original_assigned_tier) ||
      !isClientTier(result.previous_tier)
    ) {
      throw new OnboardingRouteFailure(
        "The tier changed, but the database returned an invalid tier value.",
        500,
        "INVALID_TIER_TRANSITION_RESULT"
      );
    }

    if (result.changed) {
      const { data: client, error: clientError } = await service
        .from("clients")
        .select("id, name, dot_number")
        .eq("id", clientId)
        .single();
      if (clientError || !client) {
        throw new OnboardingRouteFailure(
          `The tier changed, but the client could not be loaded for the operations notification: ${
            clientError?.message ?? "client not found"
          }`,
          502,
          "TIER_CHANGED_NOTIFICATION_CLIENT_FAILED"
        );
      }
      const baseUrl = (
        process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
      ).replace(/\/+$/, "");
      try {
        await notifyOperations(service, {
          clientId,
          actorUserId: userId,
          event: "onboarding_tier_changed",
          entityType: "clients",
          entityId: clientId,
          description: "Client changed the service tier during onboarding",
          email: {
            trigger: "staff_tier_changed",
            subject: `SafeScore tier changed during onboarding — ${client.name}`,
            heading: "Client selected a different SafeScore service",
            message:
              "The client changed the service selected in onboarding. Review the assigned and selected tiers before activation.",
            consoleUrl: `${baseUrl}/console/clients/${clientId}/account`,
            ctaLabel: "Review client account",
            details: [
              { label: "Company", value: client.name },
              { label: "USDOT", value: client.dot_number },
              {
                label: "Assigned tier",
                value: tierDisplayLabel(result.original_assigned_tier),
              },
              {
                label: "Selected tier",
                value: tierDisplayLabel(result.result_tier),
              },
              {
                label: "Previous selection",
                value: tierDisplayLabel(result.previous_tier),
              },
            ],
          },
          metadata: {
            assigned_tier: result.original_assigned_tier,
            selected_tier: result.result_tier,
            previous_tier: result.previous_tier,
          },
        });
      } catch (notificationError) {
        throw new OnboardingRouteFailure(
          `The tier changed, but the operations notification failed: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
          502,
          "TIER_CHANGED_NOTIFICATION_FAILED"
        );
      }
    }

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
