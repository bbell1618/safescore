import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardCheck, Shield, Wrench } from "lucide-react";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ClientRow = {
  name: string;
  dot_number: string;
};

type CrashJoin =
  | { crash_date: string | null; state: string | null }
  | { crash_date: string | null; state: string | null }[]
  | null;

type CpdpCaseRow = {
  id: string;
  crash_id: string | null;
  status: string;
  filed_date: string | null;
  determination_date: string | null;
  outcome: string | null;
  crashes: CrashJoin;
};

type DataqCaseRow = {
  id: string;
  violation_id: string | null;
  status: string;
  case_number: string | null;
  filed_date: string | null;
  outcome: string | null;
};

const operationalActions: Record<string, string> = {
  vehicle_maintenance:
    "Tighten pre-trip inspections and your PM schedule on the recurring items. Catching these before roadside is what brings this down - and each one drops off your record after 24 months.",
  hos_compliance:
    "Reinforce ELD and log discipline with your drivers. If we find a genuine error in a specific record we'll contest it; otherwise these ease as drivers stay current and older ones age off.",
  unsafe_driving:
    "Coach drivers on speed management and safe following distance. These are behavior-based - they improve with coaching plus time.",
  driver_fitness:
    "Keep driver qualification files complete and current (medical cards, licenses, annual reviews).",
  hazmat_compliance:
    "Tighten hazmat marking, labeling, and paperwork at dispatch.",
  controlled_substance:
    "Confirm your testing program and records are current and documented.",
};

const themeKeywords: Array<[string, string[]]> = [
  ["tires", ["tire", "tread", "inflation", "ply"]],
  ["brakes", ["brake", "air leak", "hose", "tubing"]],
  ["lighting", ["lamp", "light", "turn signal", "headlamp", "stop lamp", "clearance"]],
  ["ELD records", ["eld", "driver failing to review", "certify"]],
  ["driver logs", ["record of duty", "false report", "hours of service", "hos"]],
  ["speed management", ["speed"]],
  ["traffic-control compliance", ["traffic control", "obey"]],
  ["seat-belt use", ["seat belt"]],
  ["hazmat markings", ["marking", "id number"]],
  ["hazmat placarding", ["placard"]],
  ["qualification files", ["medical", "license", "qualification"]],
];

function getCrash(crashes: CrashJoin) {
  if (Array.isArray(crashes)) return crashes[0] ?? null;
  return crashes;
}

function monthYear(date: string | null) {
  if (!date) return "date pending";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return formatDate(date);
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function lowerBasicLabel(basicCategory: string) {
  return (BASIC_LABELS[basicCategory] ?? basicCategory.replaceAll("_", " ")).toLowerCase();
}

function burdenLevel(points: number, total: number) {
  if (total <= 0) return "minor";
  const share = points / total;
  if (share >= 0.45) return "major";
  if (share >= 0.18) return "moderate";
  return "minor";
}

function findThemes(descriptions: Array<string | null | undefined>, limit = 3) {
  const found: string[] = [];
  const text = descriptions.filter(Boolean).join(" ").toLowerCase();

  for (const [label, needles] of themeKeywords) {
    if (needles.some((needle) => text.includes(needle)) && !found.includes(label)) {
      found.push(label);
    }
    if (found.length >= limit) break;
  }

  if (found.length > 0) return found;

  return descriptions
    .filter((description): description is string => Boolean(description))
    .slice(0, limit)
    .map((description) => {
      const cleaned = description
        .replace(/\s+-\s+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return cleaned.length > 54 ? `${cleaned.slice(0, 51)}...` : cleaned;
    });
}

function joinPlainList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function plainCpdpStatus(caseRow: CpdpCaseRow) {
  if ((caseRow.status === "determination_made" || caseRow.status === "closed") && caseRow.outcome) {
    if (caseRow.outcome === "not_preventable") return "FMCSA agreed - removed from your record.";
    if (caseRow.outcome === "preventable") return "FMCSA declined - no change.";
    if (caseRow.outcome === "dismissed") return "FMCSA dismissed the request.";
    return "FMCSA issued a decision.";
  }

  if (caseRow.status === "draft") return "We're preparing this request.";
  if (caseRow.status === "filed" || caseRow.status === "pending") {
    return "Filed with FMCSA - awaiting their decision.";
  }
  if (caseRow.status === "determination_made") return "FMCSA issued a decision.";
  return "In progress.";
}

function plainDataqStatus(caseRow: DataqCaseRow) {
  if ((caseRow.status === "approved" || caseRow.outcome === "approved") && caseRow.outcome) {
    return "FMCSA agreed - removed from your record.";
  }
  if ((caseRow.status === "denied" || caseRow.outcome === "denied") && caseRow.outcome) {
    return "FMCSA declined - no change.";
  }
  if (caseRow.status === "draft") return "We're preparing this request.";
  if (caseRow.status === "filed" || caseRow.status === "pending_state" || caseRow.status === "pending_fmcsa") {
    return "Filed with FMCSA - awaiting their decision.";
  }
  if (caseRow.status === "reconsidering") return "We're asking FMCSA to reconsider.";
  if (caseRow.status === "closed" && caseRow.outcome === "withdrawn") return "Closed - withdrawn.";
  return "In progress.";
}

function isVisibleCpdpCase(caseRow: CpdpCaseRow) {
  return caseRow.status !== "draft" && (caseRow.status !== "closed" || Boolean(caseRow.outcome));
}

function isVisibleDataqCase(caseRow: DataqCaseRow) {
  return caseRow.status !== "draft" && (caseRow.status !== "closed" || Boolean(caseRow.outcome));
}

export default async function PortalPlanPage() {
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

  if (!userRecord?.client_id) redirect("/portal");

  const clientId = userRecord.client_id;

  const [{ data: client }, { data: cpdpCases }, { data: dataqCases }, burden] =
    await Promise.all([
      supabase.from("clients").select("name, dot_number").eq("id", clientId).single(),
      supabase
        .from("cpdp_cases")
        .select("id, crash_id, status, filed_date, determination_date, outcome, crashes(crash_date, state)")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("dataq_cases")
        .select("id, violation_id, status, case_number, filed_date, outcome")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      getClientBurden(clientId),
    ]);

  if (!client) redirect("/portal");

  const carrier = client as ClientRow;
  const topBasics = burden.perBasic.slice(0, 2);
  const mainBasic = topBasics[0] ?? null;
  const nextBasic = topBasics[1] ?? null;
  const mainThemes = mainBasic
    ? findThemes(
        burden.topViolations
          .filter((violation) => violation.basicCategory === mainBasic.basicCategory)
          .map((violation) => violation.violationDescription)
      )
    : [];

  const cpdpVisible = ((cpdpCases ?? []) as CpdpCaseRow[]).filter(isVisibleCpdpCase);
  const dataqVisible = ((dataqCases ?? []) as DataqCaseRow[]).filter(isVisibleDataqCase);
  const hasCases = cpdpVisible.length + dataqVisible.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1E1C1A]">Your Safety Plan</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {carrier.name} - DOT {carrier.dot_number}
        </p>
        <p className="text-sm text-gray-600 mt-3 max-w-3xl">
          A clear read on where your CSA safety scores stand and exactly what we&apos;re doing - and what you can do - to improve them.
        </p>
      </div>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Where you stand</h2>
        </div>

        {mainBasic ? (
          <div className="space-y-4">
            <div className="space-y-3 text-sm leading-6 text-gray-600 max-w-4xl">
              <p>
                Most of your safety-score pressure right now comes from {lowerBasicLabel(mainBasic.basicCategory)}
                {mainThemes.length > 0 ? ` - recurring ${joinPlainList(mainThemes)} issues.` : "."}
              </p>
              {nextBasic && (
                <p>{BASIC_LABELS[nextBasic.basicCategory] ?? nextBasic.basicCategory.replaceAll("_", " ")} is your next focus area.</p>
              )}
              <p>
                The good news: these are the kinds of things that improve with attention and drop off your record over time.
              </p>
              <p className="text-xs text-gray-500">
                Percentile is not published by FMCSA for low-volume carriers. SafeScore shows the weighted point burden that drives your BASIC measures.
              </p>
            </div>

            <div className="space-y-3">
              {burden.perBasic.slice(0, 4).map((basic) => {
                const width = burden.totalPoints > 0 ? Math.max(8, Math.round((basic.weightedPoints / burden.totalPoints) * 100)) : 0;
                const level = burdenLevel(basic.weightedPoints, burden.totalPoints);
                return (
                  <div key={basic.basicCategory}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-xs font-medium text-[#1E1C1A]">{basic.label}</span>
                      <span className="text-[10px] uppercase tracking-widest text-gray-400">{level}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#F0E8DA] overflow-hidden">
                      <div className="h-full rounded-full bg-[#C67A1E]" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No scored violations are currently in the 24-month safety window.</p>
        )}
      </section>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1E1C1A] text-sm">What we&apos;re handling for you</h2>
        </div>

        {hasCases ? (
          <div className="divide-y divide-[#F0E8DA]">
            {cpdpVisible.map((caseRow) => {
              const crash = getCrash(caseRow.crashes);
              return (
                <div key={caseRow.id} className="px-5 py-4">
                  <p className="text-sm font-medium text-[#1E1C1A]">
                    Crash review - {monthYear(crash?.crash_date ?? null)}, {crash?.state ?? "state pending"}: {plainCpdpStatus(caseRow)}
                  </p>
                  {caseRow.filed_date && (
                    <p className="text-xs text-gray-400 mt-1">Filed {formatDate(caseRow.filed_date)}</p>
                  )}
                </div>
              );
            })}
            {dataqVisible.map((caseRow) => (
              <div key={caseRow.id} className="px-5 py-4">
                <p className="text-sm font-medium text-[#1E1C1A]">
                  Violation challenge - {caseRow.case_number ? `case ${caseRow.case_number}` : "record review"}: {plainDataqStatus(caseRow)}
                </p>
                {caseRow.filed_date && (
                  <p className="text-xs text-gray-400 mt-1">Filed {formatDate(caseRow.filed_date)}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-[#1E1C1A]">Nothing is in active dispute right now.</p>
            <p className="text-xs text-gray-500 mt-1">
              We only contest records when there&apos;s a genuine basis - see your operational priorities below.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Your operational priorities</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {burden.perBasic.map((basic) => {
            const examples = findThemes(
              burden.topViolations
                .filter((violation) => violation.basicCategory === basic.basicCategory)
                .map((violation) => violation.violationDescription),
              3
            );
            return (
              <div key={basic.basicCategory} className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-[#1E1C1A] text-sm">{basic.label}</h3>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mt-1">
                      {burdenLevel(basic.weightedPoints, burden.totalPoints)} focus area
                    </p>
                  </div>
                </div>
                {examples.length > 0 && (
                  <p className="text-xs text-gray-500 mt-3">
                    Recent examples: {joinPlainList(examples)}.
                  </p>
                )}
                <p className="text-sm text-gray-600 leading-6 mt-3">
                  {operationalActions[basic.basicCategory] ??
                    "Keep the records and controls for this area current. These improve through operational attention and natural 24-month aging."}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <h2 className="font-semibold text-[#1E1C1A] text-sm mb-2">How we keep this moving</h2>
        <p className="text-sm text-gray-600 leading-6 max-w-4xl">
          SafeScore monitors your FMCSA record monthly. As you address the operational items and older violations age off, your measures improve. If a record has a genuine basis to contest, we&apos;ll handle it; we won&apos;t file challenges that don&apos;t.
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <Link
            href="/portal/safety"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[#C67A1E] text-white hover:bg-[#B86E18] transition-colors"
          >
            See the full breakdown
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href="/portal/cases"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-[#F0E8DA] text-[#1E1C1A] hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
          >
            Track active cases
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
