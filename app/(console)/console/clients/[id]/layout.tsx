import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ClientTabs } from "@/components/console/client-tabs";
import { RunAnalysisButton } from "@/components/console/run-analysis-button";
import { FmcsaExportUpload } from "@/components/console/fmcsa-export-upload";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { ChallengeabilityAnalysisButton } from "@/components/console/challengeability-analysis-button";
import { ClientActivationControl } from "@/components/console/client-activation-control";
import {
  normalizeClientTier,
  isClientTier,
  tierBadgeVariant,
  tierDisplayLabel,
} from "@/lib/tiers";

const statusLabel: Record<string, string> = {
  onboarding: "Onboarding",
  awaiting_activation: "Awaiting activation",
  active: "Active",
  prospect: "Prospect",
  paused: "Paused",
  churned: "Churned",
};

const statusVariant: Record<string, "success" | "default" | "warning" | "danger" | "outline"> = {
  onboarding: "warning",
  awaiting_activation: "warning",
  active: "success",
  prospect: "outline",
  paused: "warning",
  churned: "default",
};

export default async function ClientFileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, tier, status, dot_number, mc_number")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(id, supabase);
  const violationCountQuery = supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);
  const unassessedCountQuery = supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id)
    .is("ai_assessed_at", null);

  const [
    { data: carrierProfile },
    { count: violationCount },
    { count: unassessedCount },
    { data: latestTierChange, error: tierChangeError },
  ] = await Promise.all([
    supabase
      .from("carrier_profiles")
      .select("authority_status, entity_type")
      .eq("client_id", id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    canonicalInspectionIds.length > 0
      ? violationCountQuery.in("inspection_id", canonicalInspectionIds)
      : violationCountQuery.in("inspection_id", []),
    canonicalInspectionIds.length > 0
      ? unassessedCountQuery.in("inspection_id", canonicalInspectionIds)
      : unassessedCountQuery.in("inspection_id", []),
    supabase
      .from("activity_log")
      .select("id, description, metadata, created_at")
      .eq("client_id", id)
      .eq("action_type", "tier_changed_by_client")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (tierChangeError) {
    throw new Error(
      `Unable to load client tier-change follow-up: ${tierChangeError.message}`
    );
  }

  const cp = carrierProfile as { authority_status?: string | null; entity_type?: string | null } | null;
  const clientTier = normalizeClientTier(client.tier);
  const clientHasAssignedTier = isClientTier(client.tier);
  const tierChangeMetadata = latestTierChange?.metadata as
    | Record<string, unknown>
    | null
    | undefined;
  const originalAssignedTier = tierChangeMetadata?.assigned_tier;

  return (
    <div className="min-h-screen bg-[#FEFCF8]">
      <div className="px-6 pt-6 max-w-7xl mx-auto">
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="p-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#1E1C1A] truncate">{client.name}</h1>
              <p className="text-xs text-gray-500 mt-1">
                USDOT {client.dot_number}
                {client.mc_number ? ` | MC ${client.mc_number}` : ""}
                {cp?.authority_status ? ` | ${cp.authority_status}` : ""}
                {cp?.entity_type ? ` | ${cp.entity_type}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  Plan:
                  <Badge
                    variant={
                      clientHasAssignedTier
                        ? tierBadgeVariant(clientTier)
                        : "outline"
                    }
                  >
                    {tierDisplayLabel(client.tier)}
                  </Badge>
                  <Tooltip content="The SafeScore service tier assigned to this client. Billing and included services are handled from the Account tab." position="bottom" />
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  Status:
                  <Badge variant={statusVariant[client.status] ?? "default"}>
                    {statusLabel[client.status] ?? client.status}
                  </Badge>
                  <Tooltip content="The client record state in SafeScore. This is separate from FMCSA authority or case status." position="bottom" />
                </span>
              </div>
            </div>

            <div className="shrink-0 space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Action</p>
              <RunAnalysisButton
                clientId={id}
                dotNumber={client.dot_number}
                hasData={(violationCount ?? 0) > 0}
                hasFmcsaAccess={false}
              />
              <ChallengeabilityAnalysisButton
                clientId={id}
                totalCount={violationCount ?? 0}
                unassessedCount={unassessedCount ?? 0}
              />
              <FmcsaExportUpload clientId={id} dotNumber={client.dot_number} />
            </div>
          </div>
          {latestTierChange ? (
            <div
              className="mx-5 mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              role="status"
            >
              <p className="font-semibold">Staff follow-up required: client changed service tier</p>
              <p className="mt-1">
                GEIA originally assigned {tierDisplayLabel(originalAssignedTier)}. The client
                selected {tierDisplayLabel(client.tier)} during onboarding. Review the sale and
                billing expectation with the carrier.
              </p>
            </div>
          ) : null}
          <ClientTabs clientId={id} tier={clientTier} />
        </div>
      </div>
      {client.status === "awaiting_activation" &&
      client.tier === "assessment" ? (
        <div className="mx-auto max-w-7xl px-6 pt-5">
          <ClientActivationControl
            clientId={id}
            status={client.status}
            tier={client.tier}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
