import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatDate, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import { Info } from "lucide-react";
import { CaseTabs } from "./case-tabs";

export const dynamic = "force-dynamic";

const cpdpStatusLabel: Record<string, string> = {
  draft: "Draft",
  filed: "Filed",
  pending: "Pending",
  determination_made: "Determination made",
  closed: "Closed",
};

const cpdpStatusVariant = (
  status: string
): "default" | "info" | "warning" | "success" | "danger" | "outline" => {
  const map: Record<
    string,
    "default" | "info" | "warning" | "success" | "danger" | "outline"
  > = {
    draft: "outline",
    filed: "info",
    pending: "warning",
    determination_made: "success",
    closed: "default",
  };
  return map[status] ?? "default";
};

const cpdpOutcomeVariant = (
  outcome: string | null
): "default" | "success" | "danger" | "warning" => {
  if (outcome === "not_preventable") return "success";
  if (outcome === "preventable") return "danger";
  if (outcome === "dismissed") return "warning";
  return "default";
};

const cpdpOutcomeLabel: Record<string, string> = {
  preventable: "Preventable",
  not_preventable: "Not preventable",
  undecided: "Undecided",
  dismissed: "Dismissed",
};

export default async function PortalCasesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#F4F4F4] flex items-center justify-center">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm text-gray-500">Your account is being set up.</p>
      </div>
    );
  }

  const clientId = userRecord.client_id;

  const [{ data: dataqCases }, { data: cpdpCases }] = await Promise.all([
    supabase
      .from("dataq_cases")
      .select("*, violations(violation_code, violation_description)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("cpdp_cases")
      .select("*, crashes(crash_date, state, city, fatalities, injuries)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
  ]);

  // Build DataQs content
  const dataqContent =
    dataqCases && dataqCases.length > 0 ? (
      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <div className="divide-y divide-[#E5E5E5]">
          {dataqCases.map((c) => {
            const violation = Array.isArray(c.violations)
              ? (c.violations as { violation_code: string; violation_description: string }[])[0]
              : (c.violations as {
                  violation_code: string;
                  violation_description: string;
                } | null);

            return (
              <div key={c.id} className="px-5 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {c.case_number && (
                      <span className="text-xs font-mono text-gray-400">
                        #{c.case_number}
                      </span>
                    )}
                    {violation?.violation_code && (
                      <span className="text-xs font-medium text-[#1A1A1A] bg-gray-100 px-1.5 py-0.5 rounded">
                        {violation.violation_code}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-[#1A1A1A]">
                    {violation?.violation_description ?? "DataQ challenge"}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-400">
                    {c.filed_date && (
                      <span>Filed {formatDate(c.filed_date)}</span>
                    )}
                    {c.state_deadline && (
                      <span>Deadline {formatDate(c.state_deadline)}</span>
                    )}
                    {c.outcome_date && c.outcome && (
                      <span>Outcome {formatDate(c.outcome_date)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge variant={caseStatusVariant(c.status)}>
                    {caseStatusLabel(c.status)}
                  </Badge>
                  {c.outcome && (
                    <Badge
                      variant={
                        c.outcome === "approved"
                          ? "success"
                          : c.outcome === "denied"
                          ? "danger"
                          : "default"
                      }
                    >
                      {c.outcome.charAt(0).toUpperCase() + c.outcome.slice(1)}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ) : (
      <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-12 text-center">
        <p className="text-sm text-gray-500">No DataQ cases on file.</p>
        <p className="text-xs text-gray-400 mt-1">
          GEIA will open cases when violations are identified and eligible for challenge.
        </p>
      </div>
    );

  // Build CPDP content
  const cpdpContent =
    cpdpCases && cpdpCases.length > 0 ? (
      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <div className="divide-y divide-[#E5E5E5]">
          {cpdpCases.map((c) => {
            const crash = Array.isArray(c.crashes)
              ? (
                  c.crashes as {
                    crash_date: string;
                    state: string | null;
                    city: string | null;
                    fatalities: number;
                    injuries: number;
                  }[]
                )[0]
              : (c.crashes as {
                  crash_date: string;
                  state: string | null;
                  city: string | null;
                  fatalities: number;
                  injuries: number;
                } | null);

            return (
              <div key={c.id} className="px-5 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A]">
                    {crash
                      ? `Crash — ${formatDate(crash.crash_date)}`
                      : "CPDP filing"}
                  </p>
                  {crash && (
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                      {(crash.city || crash.state) && (
                        <span>
                          {[crash.city, crash.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                      {crash.fatalities > 0 && (
                        <span>{crash.fatalities} fatalities</span>
                      )}
                      {crash.injuries > 0 && (
                        <span>{crash.injuries} injuries</span>
                      )}
                    </div>
                  )}
                  {c.filed_date && (
                    <p className="text-xs text-gray-400 mt-1">
                      Filed {formatDate(c.filed_date)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge variant={cpdpStatusVariant(c.status)}>
                    {cpdpStatusLabel[c.status] ?? c.status}
                  </Badge>
                  {c.outcome && (
                    <Badge variant={cpdpOutcomeVariant(c.outcome)}>
                      {cpdpOutcomeLabel[c.outcome] ?? c.outcome}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ) : (
      <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-12 text-center">
        <p className="text-sm text-gray-500">No CPDP cases on file.</p>
        <p className="text-xs text-gray-400 mt-1">
          GEIA will file CPDP challenges when crashes are eligible for preventability
          determination.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1
          className="text-xl font-bold text-[#1A1A1A]"
        >
          Cases
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Active challenges and filings GEIA is managing on your account.
        </p>
      </div>

      <CaseTabs
        dataqCount={dataqCases?.length ?? 0}
        cpdpCount={cpdpCases?.length ?? 0}
        dataqContent={dataqContent}
        cpdpContent={cpdpContent}
      />
    </div>
  );
}
