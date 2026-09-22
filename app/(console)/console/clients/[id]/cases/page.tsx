import { cpdpFiledTimelineLabel } from "@/lib/cases/presentation";
import { loadCaseEvidenceCounts } from "@/lib/console-case-evidence-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { caseStatusLabel, caseStatusVariant, formatDate } from "@/lib/utils";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { normalizeClientTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

type DataqCaseRow = {
  id: string;
  violation_id: string | null;
  inspection_id: string | null;
  case_number: string | null;
  status: string;
  priority: string | null;
  filed_date: string | null;
  outcome_date: string | null;
  state_deadline: string | null;
  created_at: string;
  violations:
    | { violation_code: string | null; violation_description: string | null }
    | { violation_code: string | null; violation_description: string | null }[]
    | null;
  inspections:
    | { inspection_date: string | null; state: string | null }
    | { inspection_date: string | null; state: string | null }[]
    | null;
};

type CpdpCaseRow = {
  id: string;
  crash_id: string | null;
  case_number: string | null;
  status: string;
  filed_date: string | null;
  determination_date: string | null;
  outcome: string | null;
  created_at: string;
  crashes:
    | { crash_date: string | null; city: string | null; state: string | null; tow_away: boolean | null }
    | { crash_date: string | null; city: string | null; state: string | null; tow_away: boolean | null }[]
    | null;
};

type CrashRow = {
  id: string;
  crash_date: string | null;
  city: string | null;
  state: string | null;
  tow_away: boolean | null;
};

function firstJoin<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function cpdpStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    filed: "Filed / Pending FMCSA",
    pending: "Filed / Pending FMCSA",
    determination_made: "Determination made",
    closed: "Closed",
  };
  return labels[status] ?? status;
}

function cpdpStatusVariant(status: string): "default" | "info" | "warning" | "success" | "danger" | "outline" | "gold" {
  const variants: Record<string, "default" | "info" | "warning" | "success" | "danger" | "outline" | "gold"> = {
    draft: "gold",
    filed: "info",
    pending: "info",
    determination_made: "success",
    closed: "default",
  };
  return variants[status] ?? "default";
}

function inCurrentWindow(date: string | null) {
  if (!date) return true;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  return parsed >= cutoff;
}

export default async function CasesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();



  const [{ data: client, error: clientError }, { data: dataqCases, error: dataqError }, { data: cpdpCases, error: cpdpError }, { data: crashes, error: crashesError }] = await Promise.all([
    supabase
    .from("clients")
    .select("id, tier")
    .eq("id", id)
    .single(),
    supabase
      .from("dataq_cases")
      .select(
        "id, violation_id, inspection_id, case_number, status, priority, filed_date, outcome_date, state_deadline, created_at, violations(violation_code, violation_description), inspections(inspection_date, state)"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("cpdp_cases")
      .select(
        "id, crash_id, case_number, status, filed_date, determination_date, outcome, created_at, crashes(crash_date, city, state, tow_away)"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("crashes")
      .select("id, crash_date, city, state, tow_away")
      .eq("client_id", id)
      .order("crash_date", { ascending: false }),
  ]);

  if (clientError && clientError.code !== "PGRST116") throw new Error(`Unable to load cases client: ${clientError.message}`);
  if (!client) notFound();
  for (const error of [dataqError, cpdpError, crashesError]) if (error) throw new Error(`Unable to load case list: ${error.message}`);
  const clientTier = normalizeClientTier(client.tier);

  const dataqRows = (dataqCases ?? []) as unknown as DataqCaseRow[];
  const cpdpRows = (cpdpCases ?? []) as unknown as CpdpCaseRow[];
  const cpdpCrashIds = new Set(cpdpRows.map((row) => row.crash_id).filter(Boolean));
  const crashCandidates = ((crashes ?? []) as CrashRow[]).filter(
    (crash) => !cpdpCrashIds.has(crash.id) && crash.tow_away === true && inCurrentWindow(crash.crash_date)
  );

  const evidenceCounts = await loadCaseEvidenceCounts(dataqRows.map(row => row.id), cpdpRows.map(row => row.id));
  const unifiedRows = [
    ...dataqRows.map((row) => {
      const violation = firstJoin(row.violations);
      const inspection = firstJoin(row.inspections);
      return {
        key: `dataq-${row.id}`,
        type: "DataQ",
        expectation: row.outcome_date ? `Decision ${formatDate(row.outcome_date)}` : row.state_deadline ? `Recorded response deadline ${formatDate(row.state_deadline)}` : row.filed_date ? "Determination date not recorded" : "Not filed",
        label: row.case_number || row.id.slice(0, 8),
        subject: violation?.violation_code ?? "Violation review",
        detail: violation?.violation_description ?? "FMCSA violation challenge",
        date: row.filed_date ?? row.created_at,
        filedDate: row.filed_date,
        location: inspection?.state ?? "state pending",
        status: caseStatusLabel(row.status),
        variant: caseStatusVariant(row.status),
        href: `/console/clients/${id}/dataq?case=${row.id}`,
      };
    }),
    ...cpdpRows.map((row) => {
      const crash = firstJoin(row.crashes);
      return {
        key: `cpdp-${row.id}`,
        type: "CPDP",
        expectation: row.determination_date ? `Decision ${formatDate(row.determination_date)}` : cpdpFiledTimelineLabel(row.filed_date) ?? "Not filed",
        label: row.case_number || row.id.slice(0, 8),
        subject: "Crash preventability",
        detail: [crash?.city, crash?.state].filter(Boolean).join(", ") || "Crash review",
        date: row.filed_date ?? row.created_at,
        filedDate: row.filed_date,
        location: crash?.state ?? "state pending",
        status: cpdpStatusLabel(row.status),
        variant: row.outcome === "preventable" ? "danger" as const : row.outcome === "not_preventable" ? "success" as const : cpdpStatusVariant(row.status),
        href: `/console/clients/${id}/cpdp/${row.id}`,
      };
    }),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const openDataq = dataqRows.filter((row) => !["approved", "denied", "closed"].includes(row.status)).length;
  const openCpdp = cpdpRows.filter((row) => !["closed", "determination_made"].includes(row.status)).length;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <header className="portal-navy-texture rounded-2xl p-6 text-warm-white"><p className="font-mono text-xs uppercase tracking-widest text-gold-light">Challenge work</p><h1 className="mt-2 font-heading text-4xl">Cases</h1><p className="mt-3 text-sm text-warm-white/75">{unifiedRows.length} records · {openDataq + openCpdp} open reviews</p><div className="mt-5 flex flex-wrap gap-3"><Link className="btn-primary min-h-11" href={`/console/clients/${id}/violations`}>New DataQ</Link><Link className="btn-primary min-h-11" href={`/console/clients/${id}/cpdp`}>New CPDP</Link></div></header>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Open DataQs</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{openDataq}</p>
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Open CPDP</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{openCpdp}</p>
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">CPDP review candidates</p>
          <p className="text-2xl font-bold text-[#C67A1E] mt-1">{crashCandidates.length}</p>
        </div>
      </div>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="p-5 border-b border-[#F0E8DA] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-heading text-2xl text-navy">Case register</h2>
            <p className="text-sm text-gray-500 mt-0.5">DataQs violation challenges and CPDP crash reviews in one work queue.</p>
          </div>
          <div className="flex gap-2">
            <ServiceTierChip tier={clientTier} feature="case_visibility" />
            <Link className="px-3 py-2 rounded-lg text-sm font-medium border border-[#F0E8DA] text-[#1E1C1A] hover:text-[#C67A1E]" href={`/console/clients/${id}/dataq`}>
              DataQs workbench
            </Link>
            <Link className="px-3 py-2 rounded-lg text-sm font-medium border border-[#F0E8DA] text-[#1E1C1A] hover:text-[#C67A1E]" href={`/console/clients/${id}/cpdp`}>
              CPDP workbench
            </Link>
          </div>
        </div>
        <ul className="divide-y divide-sand bg-warm-white">
          {unifiedRows.map(row => <li key={row.key} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
            <div><div className="flex flex-wrap items-center gap-2"><Badge variant={row.type === "CPDP" ? "info" : "warning"}>{row.type}</Badge><span className="font-mono text-xs text-warm-gray">{row.label}</span><Badge variant={row.variant} className={row.variant === "danger" ? "bg-error-light text-error" : row.variant === "success" ? "bg-success-light text-success" : "bg-info-light text-info"}>{row.status}</Badge></div><h3 className="mt-2 font-heading text-xl text-navy">{row.subject}</h3><p className="mt-1 text-sm text-warm-mid">{row.detail}</p></div>
            <div className="text-sm text-warm-mid"><p className="font-mono text-xs">{row.filedDate ? `Filed ${formatDate(row.filedDate)}` : `Created ${formatDate(row.date)} · not filed`}</p><p className="mt-2">{row.expectation}</p><p className="mt-2 font-mono text-xs">{evidenceCounts[row.key] ?? 0} evidence files on record</p></div>
            <Link className="inline-flex min-h-11 items-center self-center rounded-lg border border-sand px-4 text-sm font-semibold text-amber-dark hover:bg-amber-subtle" href={row.href}>Open case →</Link>
          </li>)}
          {unifiedRows.length === 0 && <li className="p-8"><h3 className="font-heading text-xl text-navy">No cases on file</h3><p className="mt-2 text-sm text-warm-mid">Start with a violation or crash record to open a review.</p></li>}
        </ul>
      </section>

      {crashCandidates.length > 0 && (
        <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">CPDP review candidates</h2>
          <p className="text-xs text-gray-500 mt-1">Tow-away crashes in the 24-month window with no CPDP case yet.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {crashCandidates.slice(0, 8).map((crash) => (
              <Badge key={crash.id} variant="outline">
                {formatDate(crash.crash_date)}{"\u00B7"} {crash.state ?? "state pending"}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
