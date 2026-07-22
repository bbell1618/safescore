import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  normalizeClientTier,
  type TierFeature,
} from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { evaluatePortalFeatureGate } from "@/lib/portal/feature-gate";
import { redirect } from "next/navigation";

type PortalContext =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "unlinked" }
  | {
      status: "linked";
      clientId: string;
      tier: ClientTier;
      userId: string;
      userEmail: string | undefined;
      supabase: Awaited<ReturnType<typeof createClient>>;
    };

export async function loadPortalContext(): Promise<PortalContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };

  const service = await createServiceClient();
  const { data: userRow, error: userError } = await service
    .from("users")
    .select("role, client_id")
    .eq("id", user.id)
    .single();
  if (userError) {
    throw new Error(`Unable to verify portal account: ${userError.message}`);
  }
  if (userRow?.role !== "client_user") return { status: "forbidden" };
  if (!userRow.client_id) return { status: "unlinked" };

  const { data: client, error: clientError } = await service
    .from("clients")
    .select("tier")
    .eq("id", userRow.client_id)
    .single();
  if (clientError || !client) {
    throw new Error(
      `Unable to load portal tier: ${clientError?.message ?? "Client record not found"}`
    );
  }

  return {
    status: "linked",
    clientId: userRow.client_id,
    tier: normalizeClientTier(client.tier),
    userId: user.id,
    userEmail: user.email,
    supabase,
  };
}

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
