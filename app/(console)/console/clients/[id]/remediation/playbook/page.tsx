import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import { PlaybookGenerationControl } from "@/components/console/playbook-generation-control";
import { Badge } from "@/components/ui/badge";
import type {
  PlaybookFamilyProgram,
  PlaybookInstallment,
  PlaybookNarrative,
  PlaybookOwnerModule,
  PlaybookSourceSnapshot,
} from "@/lib/playbooks/types";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeClientTier,
  tierHasFeature,
  TIER_LABELS,
} from "@/lib/tiers";

export const dynamic = "force-dynamic";

type ClientPlaybookRow = {
  id: string;
  client_id: string;
  version: number;
  template_version: string;
  trailing_window_days: number;
  source_as_of: string;
  owner_curriculum: PlaybookOwnerModule[];
  family_programs: PlaybookFamilyProgram[];
  installment_calendar: PlaybookInstallment[];
  ai_content: PlaybookNarrative;
  source_snapshot: PlaybookSourceSnapshot;
  generated_by: string;
  generated_at: string;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatShortDate(value: string | null) {
  if (!value) return "No dated violation";
  const parsed = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

async function loadStaffClient(clientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const [{ data: staff, error: staffError }, { data: client, error: clientError }] =
    await Promise.all([
      supabase.from("users").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("clients")
        .select("id, name, dot_number, tier")
        .eq("id", clientId)
        .maybeSingle(),
    ]);

  if (staffError) {
    throw new Error(`Unable to verify playbook access: ${staffError.message}`);
  }
  if (
    !staff ||
    (staff.role !== "geia_admin" && staff.role !== "geia_staff")
  ) {
    redirect("/portal");
  }
  if (clientError) {
    throw new Error(`Unable to load playbook client: ${clientError.message}`);
  }
  if (!client) notFound();

  return { client, supabase };
}

export default async function PlaybookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { client, supabase } = await loadStaffClient(id);
  const clientTier = normalizeClientTier(client.tier);
  const allowed = tierHasFeature(clientTier, "playbook_coach");

  if (!allowed) {
    return (
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <Link
          href={`/console/clients/${id}/remediation`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-[#9A5A14]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Remediation
        </Link>
        <PlaybookGenerationControl
          clientId={id}
          clientTier={clientTier}
          hasPlaybook={false}
          allowed={false}
        />
      </div>
    );
  }

  const { data, error } = await supabase
    .from("client_playbooks")
    .select("*")
    .eq("client_id", id)
    .order("version", { ascending: false });

  if (error) {
    throw new Error(`Unable to load client playbooks: ${error.message}`);
  }

  const playbooks = (data ?? []) as ClientPlaybookRow[];
  const requestedVersion = Number.parseInt(query.version ?? "", 10);
  const selected =
    (Number.isFinite(requestedVersion)
      ? playbooks.find((playbook) => playbook.version === requestedVersion)
      : null) ??
    playbooks[0] ??
    null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <Link
        href={`/console/clients/${id}/remediation`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-[#9A5A14]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Remediation
      </Link>

      <header className="rounded-2xl border border-[#E7DDCE] bg-[#FBF7F0] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8B5E2B]">
              Lane C coaching system
            </p>
            <h1 className="mt-2 text-2xl font-bold text-[#1E1C1A]">
              Safety playbook
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              {client.name}
              {" \u00B7 "}
              USDOT {client.dot_number}. The structure and
              installments are deterministic; AI supplies only bounded coaching
              language grounded in the live Lane C record.
            </p>
          </div>
          <PlaybookGenerationControl
            clientId={id}
            clientTier={clientTier}
            hasPlaybook={playbooks.length > 0}
            allowed
          />
        </div>
      </header>

      {selected ? (
        <>
          <section className="rounded-xl border border-[#F0E8DA] bg-white p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="gold">Version {selected.version}</Badge>
                  <Badge variant="outline">
                    {TIER_LABELS[clientTier]} playbook
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-gray-600">
                  Generated {formatTimestamp(selected.generated_at)} from the
                  Lane C record as of {formatShortDate(selected.source_as_of)}.
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Template {selected.template_version}
                </p>
              </div>
              {playbooks.length > 1 && (
                <nav
                  aria-label="Playbook versions"
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-xs font-medium text-gray-500">
                    Versions
                  </span>
                  {playbooks.map((playbook) => (
                    <Link
                      key={playbook.id}
                      href={`/console/clients/${id}/remediation/playbook?version=${playbook.version}`}
                      aria-current={
                        playbook.id === selected.id ? "page" : undefined
                      }
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        playbook.id === selected.id
                          ? "border-[#C67A1E] bg-[#FDF4E7] text-[#9A5A14]"
                          : "border-[#E7DDCE] text-gray-500 hover:border-[#C67A1E]"
                      }`}
                    >
                      v{playbook.version}
                    </Link>
                  ))}
                </nav>
              )}
            </div>

            <dl className="mt-5 grid gap-3 border-t border-[#F0E8DA] pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Lane C burden"
                value={`${selected.source_snapshot.laneCWeightedPoints} pts`}
                detail={`${selected.source_snapshot.laneCViolationCount} violations`}
              />
              <Metric
                label="Active programs"
                value={String(selected.family_programs.length)}
                detail="Families present only"
              />
              <Metric
                label="Inflow window"
                value={`${selected.trailing_window_days} days`}
                detail="Violations per month"
              />
              <Metric
                label="Unmapped codes"
                value={String(selected.source_snapshot.unmappedCodes.length)}
                detail={
                  selected.source_snapshot.unmappedCodes.length
                    ? "Routed to General Safety"
                    : "All mapped"
                }
              />
            </dl>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B5E2B]">
                Part A
              </p>
              <h2 className="mt-1 text-lg font-bold text-[#1E1C1A]">
                Owner curriculum
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Four short operating modules establish the management system
                behind every family program.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {selected.owner_curriculum.map((module) => (
                <article
                  key={module.key}
                  id={`module-${module.key.toLowerCase()}`}
                  className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge variant="outline">{module.key}</Badge>
                      <h3 className="mt-2 font-semibold text-[#1E1C1A]">
                        {module.title}
                      </h3>
                    </div>
                    <span className="text-xs text-gray-400">
                      {module.installment}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-gray-600">
                    {module.content}
                  </p>
                  <Deliverables
                    title="Included"
                    items={module.deliverables}
                  />
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B5E2B]">
                Installment plan
              </p>
              <h2 className="mt-1 text-lg font-bold text-[#1E1C1A]">
                Twelve-month calendar
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                One deliberate bite-size focus at a time, with foundations
                first and reinforcement after the initial six months.
              </p>
            </div>
            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {selected.installment_calendar.map((installment) => (
                <InstallmentCard
                  key={installment.month}
                  installment={installment}
                />
              ))}
            </ol>
          </section>

          <section className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8B5E2B]">
                Part B
              </p>
              <h2 className="mt-1 text-lg font-bold text-[#1E1C1A]">
                Family programs
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Only families present in the current scored Lane C burden are
                included. Each program tracks rolling inflow from actual
                inspection dates.
              </p>
            </div>
            <div className="space-y-4">
              {selected.family_programs.map((program) => (
                <FamilyProgramCard key={program.familyKey} program={program} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-dashed border-[#DCCCB5] bg-white px-6 py-12 text-center">
          <ShieldCheck
            className="mx-auto h-8 w-8 text-[#C67A1E]"
            aria-hidden="true"
          />
          <h2 className="mt-3 text-lg font-semibold text-[#1E1C1A]">
            No playbook generated yet
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
            Generate the first version to turn the client&apos;s live Lane C
            burden into owner modules, present-family programs, and a monthly
            installment calendar.
          </p>
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-[#FBF7F0] p-3">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-1 text-lg font-bold text-[#1E1C1A]">{value}</dd>
      <dd className="mt-0.5 text-xs text-gray-500">{detail}</dd>
    </div>
  );
}

function Deliverables({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4 border-t border-[#E7DDCE] pt-3">
      <p className="text-xs font-semibold text-[#4D463E]">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2 text-xs leading-5 text-gray-500"
          >
            <ClipboardCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8B5E2B]"
              aria-hidden="true"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InstallmentCard({
  installment,
}: {
  installment: PlaybookInstallment;
}) {
  return (
    <li className="rounded-xl border border-[#F0E8DA] bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FDF4E7] text-sm font-bold text-[#9A5A14]">
          {installment.month}
        </div>
        <div>
          <p className="text-xs text-gray-400">Month {installment.month}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-[#1E1C1A]">
            {installment.title}
          </h3>
        </div>
      </div>
      <p className="mt-3 text-sm leading-5 text-gray-600">
        {installment.objective}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {installment.ownerModuleKeys.map((key) => (
          <Badge key={key} variant="outline">
            {key}
          </Badge>
        ))}
        {installment.familyKeys.map((key) => (
          <Badge key={key}>{key.replaceAll("_", " ")}</Badge>
        ))}
      </div>
      <Deliverables title="This installment" items={installment.deliverables} />
    </li>
  );
}

function FamilyProgramCard({ program }: { program: PlaybookFamilyProgram }) {
  return (
    <article
      id={`program-${program.familyKey}`}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-[#E7DDCE] bg-white"
    >
      <header className="border-b border-[#F0E8DA] bg-[#FBF7F0] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="gold">{program.familyCode}</Badge>
              {program.familyKey === "general_safety" && (
                <Badge variant="warning">Mapping review needed</Badge>
              )}
            </div>
            <h3 className="mt-2 text-lg font-bold text-[#1E1C1A]">
              {program.familyName}
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
              {program.introduction}
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4">
            <SmallMetric label="Violations" value={String(program.count)} />
            <SmallMetric label="Points" value={String(program.points)} />
            <SmallMetric
              label={`${program.trailingWindowDays}-day inflow`}
              value={`${program.inflowRatePerMonth.toFixed(2)}/mo`}
            />
            <SmallMetric
              label="Latest"
              value={formatShortDate(program.latestViolationDate)}
            />
          </dl>
        </div>
      </header>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-[#8B5E2B]">
              Why this family matters
            </h4>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {program.riskContext}
            </p>
          </div>
          <div className="rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] p-4">
            <h4 className="text-sm font-semibold text-[#1E1C1A]">
              Coaching language
            </h4>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {program.coachingLanguage}
            </p>
          </div>
          <Deliverables title="Program" items={program.program} />
          <Deliverables title="Working when" items={program.workingWhen} />
          <Deliverables title="Installments" items={program.installments} />
        </div>

        <div>
          <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-[#8B5E2B]">
            Live Lane C facts
          </h4>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[#F0E8DA]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FBF7F0] text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Inspection</th>
                  <th className="px-3 py-2 text-right font-medium">Severity</th>
                  <th className="px-3 py-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0E8DA]">
                {program.violations.map((violation) => (
                  <tr key={violation.id}>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-[#1E1C1A]">
                        {violation.code}
                      </span>
                      {violation.oos && (
                        <span className="ml-1 text-[10px] font-semibold text-red-600">
                          OOS
                        </span>
                      )}
                      {violation.description && (
                        <span className="mt-0.5 block max-w-xs text-[10px] leading-4 text-gray-400">
                          {violation.description}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-500">
                      {formatShortDate(violation.inspectionDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500">
                      {violation.severityWeight}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[#1E1C1A]">
                      {violation.weightedPoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <SmallStat icon={<Gauge />} label="Avg severity" value={program.averageSeverity.toFixed(1)} />
            <SmallStat icon={<ShieldCheck />} label="OOS rows" value={String(program.oosCount)} />
            <SmallStat
              icon={<CalendarDays />}
              label={`${program.trailingWindowDays}-day rows`}
              value={String(program.inflowCount)}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-[#1E1C1A]">{value}</dd>
    </div>
  );
}

function SmallStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-[#FBF7F0] p-3">
      <div className="flex items-center gap-1.5 text-[#8B5E2B] [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <p className="mt-1 text-sm font-bold text-[#1E1C1A]">{value}</p>
    </div>
  );
}
