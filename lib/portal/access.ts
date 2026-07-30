import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  normalizeClientTier,
  type TierFeature,
} from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { evaluatePortalFeatureGate } from "@/lib/portal/feature-gate";
import { redirect } from "next/navigation";
import { cache } from "react";

export type PortalContext =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | {
      status: "unlinked";
      userId: string;
      userEmail: string | undefined;
    }
  | {
      status: "linked";
      clientId: string;
      clientName: string;
      dotNumber: string;
      mcNumber: string | null;
      tier: ClientTier;
      fmcsaAuthorized: boolean;
      clientStatus: string | null;
      serviceAgreementAccepted: boolean;
      userId: string;
      userEmail: string | undefined;
      supabase: Awaited<ReturnType<typeof createClient>>;
    };

/**
 * Resolve the signed-in portal user and linked client once per render request.
 *
 * Portal layouts and pages both consume this helper. React cache keeps those
 * consumers on the same auth/client lookup rather than repeating the shell
 * query for every nested route.
 */
export const loadPortalContext = cache(async (): Promise<PortalContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };

  const service = await createServiceClient();
  const { data: userRow, error: userError } = await service
    .from("users")
    .select(
      "role, client_id, clients(name, dot_number, mc_number, tier, fmcsa_authorized, status, service_agreement_accepted)"
    )
    .eq("id", user.id)
    .single();
  if (userError) {
    throw new Error(`Unable to verify portal account: ${userError.message}`);
  }
  if (userRow?.role !== "client_user") return { status: "forbidden" };
  if (!userRow.client_id) {
    return {
      status: "unlinked",
      userId: user.id,
      userEmail: user.email,
    };
  }

  const client = Array.isArray(userRow.clients)
    ? userRow.clients[0]
    : userRow.clients;
  if (!client) {
    throw new Error("Unable to load portal client: Client record not found");
  }

  return {
    status: "linked",
    clientId: userRow.client_id,
    clientName: client.name,
    dotNumber: client.dot_number,
    mcNumber: client.mc_number,
    tier: normalizeClientTier(client.tier),
    fmcsaAuthorized: client.fmcsa_authorized === true,
    clientStatus: client.status ?? null,
    serviceAgreementAccepted: client.service_agreement_accepted === true,
    userId: user.id,
    userEmail: user.email,
    supabase,
  };
});

export async function getPortalClientPageContext() {
  const context = await loadPortalContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status === "forbidden") redirect("/console");
  if (context.status === "unlinked") redirect("/portal");
  return context;
}

export async function getPortalPageAccess(feature: TierFeature) {
  const context = await getPortalClientPageContext();
  const gate = evaluatePortalFeatureGate(context.tier, feature);
  return {
    ...context,
    ...gate,
  };
}

export async function getPortalApiAccess(feature: TierFeature) {
  const context = await loadPortalContext();
  return context.status === "linked"
    ? {
        ...context,
        ...evaluatePortalFeatureGate(context.tier, feature),
      }
    : context;
}
