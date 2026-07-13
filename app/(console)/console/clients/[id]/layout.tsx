import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ClientTabs } from "@/components/console/client-tabs";
import { RunAnalysisButton } from "@/components/console/run-analysis-button";
import { FmcsaExportUpload } from "@/components/console/fmcsa-export-upload";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

const tierLabel: Record<string, string> = {
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

const statusLabel: Record<string, string> = {
  onboarding: "Onboarding",
  active: "Active",
  prospect: "Prospect",
  paused: "Paused",
  churned: "Churned",
};

const statusVariant: Record<string, "success" | "default" | "warning" | "danger" | "outline"> = {
  onboarding: "warning",
  active: "success",
  prospect: "outline",
  paused: "warning",
  churned: "default",
};

function tierVariant(tier: string | null): "gold" | "info" | "default" {
  if (tier === "total_safety") return "gold";
  if (tier === "remediate") return "info";
  return "default";
}

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

  const [{ data: carrierProfile }, { count: violationCount }] = await Promise.all([
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
  ]);

  const cp = carrierProfile as { authority_status?: string | null; entity_type?: string | null } | null;

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
                {client.tier && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    Plan:
                    <Badge variant={tierVariant(client.tier)}>{tierLabel[client.tier] ?? client.tier}</Badge>
                    <Tooltip content="The SafeScore service tier assigned to this client. Billing and included services are handled from the Account tab." position="bottom" />
                  </span>
                )}
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
              <FmcsaExportUpload clientId={id} dotNumber={client.dot_number} />
            </div>
          </div>
          <ClientTabs clientId={id} />
        </div>
      </div>
      {children}
    </div>
  );
}
