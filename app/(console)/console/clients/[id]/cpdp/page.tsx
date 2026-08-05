import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ChevronRight, Car, AlertTriangle } from "lucide-react";
import { CpdpCreateButton } from "@/components/console/cpdp-create-button";
import { normalizeClientTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

type CrashSummary = {
  id: string;
  crash_date: string;
  city: string | null;
  state: string | null;
  tow_away: boolean;
  hazmat_release: boolean;
  cpdp_eligible: boolean | null;
  cpdp_eligible_types: string[] | null;
  fatalities: number | null;
  injuries: number | null;
  cpdp_cases: Array<{ id: string; status: string }>;
};

export default async function CpdpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();
  const clientTier = normalizeClientTier(client.tier);

  const { data: crashes } = await supabase
    .from("crashes")
    .select("*, cpdp_cases(*)")
    .eq("client_id", id)
    .order("crash_date", { ascending: false });

  const { data: cpdpCases } = await supabase
    .from("cpdp_cases")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const displayCrashes = (crashes ?? []) as CrashSummary[];

  const cpdpStatusLabel: Record<string, string> = {
    draft: "Draft",
    filed: "Filed / Pending FMCSA",
    pending: "Filed / Pending FMCSA", // deprecated — maps to 'filed'
    determination_made: "Determination made",
    closed: "Closed",
  };

  const cpdpStatusBadgeVariant = (
    status: string
  ): "default" | "info" | "warning" | "success" | "gold" => {
    const map: Record<string, "default" | "info" | "warning" | "success" | "gold"> = {
      draft: "gold",
      filed: "info",
      pending: "info", // deprecated — maps to 'filed'
      determination_made: "success",
      closed: "default",
    };
    return map[status] ?? "default";
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#C67A1E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#C67A1E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1E1C1A] font-medium">CPDP workbench</span>
      </div>

      <div>
        <h1
          className="text-xl font-bold text-[#1E1C1A]"
        >
          CPDP workbench
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Crash Preventability Determination Program — {displayCrashes.length} crashes, {cpdpCases?.length ?? 0} submissions
        </p>
      </div>

      {/* Crash list */}
      <div className="space-y-3">
        {displayCrashes.length === 0 ? (
          <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-[#1E1C1A]">No crash records found</p>
            <p className="text-xs text-gray-400 mt-1">
              Run full analysis to import crash data.
            </p>
          </div>
        ) : (
          displayCrashes.map((crash) => {
            const hasCase = Array.isArray(crash.cpdp_cases) && crash.cpdp_cases.length > 0;
            return (
              <div key={crash.id} className={`bg-[#FBF7F0] rounded-xl border p-5 transition-all ${hasCase ? "border-[#E2D7C7] hover:-translate-y-0.5 hover:border-[#C67A1E]/60 hover:shadow-md" : "border-[#F0E8DA]"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Car className="w-4 h-4 text-gray-400" />
                      <p className="font-semibold text-[#1E1C1A] text-sm">
                        {formatDate(crash.crash_date)} — {crash.city}, {crash.state}
                      </p>
                      {crash.tow_away && <Badge variant="warning">Tow-away</Badge>}
                      {crash.hazmat_release && <Badge variant="danger">Hazmat</Badge>}
                      {crash.cpdp_eligible === true && <Badge variant="success">CPDP eligible</Badge>}
                      {crash.cpdp_eligible === false && <Badge variant="default">Not eligible</Badge>}
                      {crash.cpdp_eligible === null && <Badge variant="gold">Eligibility pending</Badge>}
                    </div>
                    {crash.cpdp_eligible_types && crash.cpdp_eligible_types.length > 0 && (
                      <p className="text-xs text-gray-500 mb-2">
                        Eligible types: {crash.cpdp_eligible_types.join(", ")}
                      </p>
                    )}
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>Fatalities: {crash.fatalities ?? 0}</span>
                      <span>Injuries: {crash.injuries ?? 0}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!hasCase && crash.cpdp_eligible !== false && (
                      <CpdpCreateButton clientId={id} crashId={crash.id} clientTier={clientTier} />
                    )}
                    {hasCase && (() => {
                      const caseObj = crash.cpdp_cases[0];
                      const caseStatus = caseObj?.status ?? "draft";
                      const caseDetailHref = `/console/clients/${id}/cpdp/${caseObj?.id}`;
                      return (
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant={cpdpStatusBadgeVariant(caseStatus)}>
                            {cpdpStatusLabel[caseStatus] ?? caseStatus}
                          </Badge>
                          <Link
                            href={caseDetailHref}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#C67A1E]/40 bg-white px-3 py-2 text-xs font-semibold text-[#9A5B13] hover:border-[#C67A1E] hover:bg-[#FDF4E7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
                          >
                            Open case
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
