import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { getMockCrashes } from "@/lib/fmcsa/client";
import { ChevronRight, Car, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

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

  // If no crashes in DB, show mock data
  const displayCrashes = crashes && crashes.length > 0
    ? crashes
    : getMockCrashes(client.dot_number).map((c) => ({
        id: c.reportNumber,
        crash_date: c.crashDate,
        state: c.state,
        city: c.city,
        fatalities: c.fatalities,
        injuries: c.injuries,
        tow_away: c.towAway,
        hazmat_release: c.hazmatRelease,
        cpdp_eligible: null,
        cpdp_eligible_types: null,
        ai_assessed_at: null,
        cpdp_cases: [],
        _isMock: true,
      }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/console" className="hover:text-[#DC362E]">Clients</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/console/clients/${id}`} className="hover:text-[#DC362E]">{client.name}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#1A1A1A] font-medium">CPDP workbench</span>
      </div>

      <div>
        <h1
          className="text-xl font-bold text-[#1A1A1A]"
        >
          CPDP workbench
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Crash Preventability Determination Program — {displayCrashes.length} crashes, {cpdpCases?.length ?? 0} submissions
        </p>
      </div>

      {/* Crash list */}
      <div className="space-y-3">
        {displayCrashes.map((crash: any) => {
          const hasCase = Array.isArray(crash.cpdp_cases) && crash.cpdp_cases.length > 0;
          return (
            <div key={crash.id} className="bg-white rounded-xl border border-[#E5E5E5] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Car className="w-4 h-4 text-gray-400" />
                    <p className="font-semibold text-[#1A1A1A] text-sm">
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
                    <button className="px-3 py-1.5 text-xs font-medium bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors">
                      Create CPDP submission
                    </button>
                  )}
                  {hasCase && (
                    <Badge variant="info">Submission filed</Badge>
                  )}
                </div>
              </div>

              {crash._isMock && (
                <p className="text-[10px] text-gray-400 mt-3 border-t border-[#E5E5E5] pt-2">
                  Mock data — run full analysis and import crashes to enable CPDP submission workflow.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
