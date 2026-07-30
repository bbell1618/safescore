import Link from "next/link";
import { Suspense } from "react";
import {
  CalendarClock,
  FileCheck2,
  FolderOpen,
  LockKeyhole,
} from "lucide-react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import { RequestUpload } from "@/components/portal/request-upload";
import { getPortalClientPageContext } from "@/lib/portal/access";
import {
  minimumTierForFeature,
  TIER_LABELS,
  tierHasFeature,
  type TierFeature,
} from "@/lib/tiers";
import DocumentVault, {
  type PortalDocumentRow,
} from "./document-vault";

export const dynamic = "force-dynamic";

type PortalSupabase = Awaited<
  ReturnType<typeof getPortalClientPageContext>
>["supabase"];

type RequestedEvidenceItem = {
  evidenceId: string;
  label: string;
  contextNote: string | null;
};

type ClientRequestRow = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  requested_items: unknown;
  due_at: string | null;
  created_at: string;
};

type SentReportRow = {
  id: string;
  type: string;
  title: string;
  sent_at: string | null;
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  assessment: "Assessment report",
  monthly: "Monthly progress report",
  quarterly: "Quarterly report",
  improvement: "Improvement report",
  underwriter: "Underwriter report",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function requestedEvidenceItems(value: unknown): RequestedEvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("evidenceId" in item) ||
      !("label" in item) ||
      typeof item.evidenceId !== "string" ||
      typeof item.label !== "string"
    ) {
      return [];
    }
    return [
      {
        evidenceId: item.evidenceId,
        label: item.label,
        contextNote:
          "contextNote" in item && typeof item.contextNote === "string"
            ? item.contextNote
            : null,
      },
    ];
  });
}

async function loadOpenRequests(
  supabase: PortalSupabase,
  clientId: string,
  includeMcs150: boolean
): Promise<ClientRequestRow[]> {
  let query = supabase
    .from("client_requests")
    .select(
      "id, category, title, description, requested_items, due_at, created_at"
    )
    .eq("client_id", clientId)
    .eq("responsibility", "client")
    .eq("status", "open");

  if (!includeMcs150) {
    query = query.neq("category", "mcs150_truth_up");
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error) {
    throw new Error(`Unable to load document requests: ${error.message}`);
  }
  return (data ?? []) as ClientRequestRow[];
}

async function loadDocuments(
  supabase: PortalSupabase,
  clientId: string
): Promise<PortalDocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, category, file_size, created_at, status")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Unable to load your document vault: ${error.message}`);
  }
  return (data ?? []) as PortalDocumentRow[];
}

async function loadSentReports(
  supabase: PortalSupabase,
  clientId: string
): Promise<SentReportRow[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("id, type, title, sent_at")
    .eq("client_id", clientId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`Unable to load reports from GEIA: ${error.message}`);
  }
  return (data ?? []) as SentReportRow[];
}

function ZoneFrame({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="portal-section-enter scroll-mt-28 rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-5">
        <h2 className="font-heading text-xl font-semibold text-warm-dark">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-warm-mid">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ZoneLocked({
  feature,
  title,
}: {
  feature: TierFeature;
  title: string;
}) {
  const minimumTier = minimumTierForFeature(feature);
  return (
    <div className="rounded-lg border border-sand bg-cream px-5 py-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-subtle">
        <LockKeyhole className="h-5 w-5 text-amber" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-semibold text-warm-dark">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-warm-mid">
        This is included with {TIER_LABELS[minimumTier]} and higher service
        plans. Ask your Golden Era SafeScore team if you want to add it.
      </p>
    </div>
  );
}

function EmptyZone({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FolderOpen;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-sand bg-cream px-5 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-warm-gray" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-warm-dark">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-warm-mid">
        {description}
      </p>
    </div>
  );
}

function ZoneSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6">
      <div className="space-y-2">
        <div className="h-6 w-44 animate-pulse rounded bg-sand" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-cream" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 rounded-lg border border-sand bg-cream p-4"
          >
            <div className="h-10 w-10 animate-pulse rounded bg-sand" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-sand" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-sand" />
            </div>
            <div className="h-8 w-24 animate-pulse rounded bg-sand" />
          </div>
        ))}
      </div>
    </section>
  );
}

async function NeededFromYouSection({
  requestPromise,
}: {
  requestPromise: Promise<ClientRequestRow[]> | null;
}) {
  if (!requestPromise) {
    return (
      <ZoneFrame
        id="needed-from-you"
        title="Needed from you"
        description="Send the records only your team can provide. GEIA handles the rest."
      >
        <ZoneLocked
          feature="evidence_requests"
          title="Document requests are not included in your service plan"
        />
      </ZoneFrame>
    );
  }

  const requests = await requestPromise;
  return (
    <ZoneFrame
      id="needed-from-you"
      title="Needed from you"
      description="Send the records only your team can provide. GEIA handles the rest."
    >
      {requests.length === 0 ? (
        <EmptyZone
          icon={FileCheck2}
          title="Nothing needed from you right now"
          description="When GEIA needs a record or document, the request and upload button will appear here."
        />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const items = requestedEvidenceItems(request.requested_items);
            return (
              <article
                key={request.id}
                className="rounded-lg border border-sand bg-cream p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-base font-semibold text-warm-dark">
                      {request.title}
                    </h3>
                    {request.description ? (
                      <p className="mt-1 text-sm leading-6 text-warm-mid">
                        {request.description}
                      </p>
                    ) : null}
                    {request.due_at ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-dark">
                        <CalendarClock
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Please send by {formatDate(request.due_at)}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-amber-subtle px-2.5 py-1 text-xs font-semibold text-amber-dark">
                    Action needed
                  </span>
                </div>

                {items.length > 0 ? (
                  <div className="mt-4 divide-y divide-sand overflow-hidden rounded-lg border border-sand bg-warm-white">
                    {items.map((item) => (
                      <div key={item.evidenceId} className="p-4">
                        <p className="text-sm font-semibold text-warm-dark">
                          {item.label}
                        </p>
                        {item.contextNote ? (
                          <p className="mt-1 text-xs leading-5 text-warm-mid">
                            {item.contextNote}
                          </p>
                        ) : null}
                        <RequestUpload
                          requestId={request.id}
                          evidenceId={item.evidenceId}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <RequestUpload requestId={request.id} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </ZoneFrame>
  );
}

async function VaultSection({
  documentPromise,
}: {
  documentPromise: Promise<PortalDocumentRow[]> | null;
}) {
  if (!documentPromise) {
    return (
      <ZoneFrame
        id="vault"
        title="Your document vault"
        description="Keep your compliance records organized in one secure place."
      >
        <ZoneLocked
          feature="compliance_layer"
          title="The compliance document vault is not included in your service plan"
        />
      </ZoneFrame>
    );
  }

  const documents = await documentPromise;
  return (
    <ZoneFrame
      id="vault"
      title="Your document vault"
      description="Keep your compliance records organized in one secure place."
    >
      <DocumentVault initialDocuments={documents} />
    </ZoneFrame>
  );
}

async function FromGeiaSection({
  reportPromise,
}: {
  reportPromise: Promise<SentReportRow[]> | null;
}) {
  if (!reportPromise) {
    return (
      <ZoneFrame
        id="from-geia"
        title="From GEIA"
        description="Open reports that your Golden Era SafeScore team has sent."
      >
        <ZoneLocked
          feature="monthly_reports"
          title="Client reports are not included in your service plan"
        />
      </ZoneFrame>
    );
  }

  const reports = await reportPromise;
  return (
    <ZoneFrame
      id="from-geia"
      title="From GEIA"
      description="Open reports that your Golden Era SafeScore team has sent."
    >
      {reports.length === 0 ? (
        <EmptyZone
          icon={FolderOpen}
          title="No reports have been sent yet"
          description="A report will appear here after GEIA finishes its review and sends it to your company."
        />
      ) : (
        <div className="divide-y divide-sand overflow-hidden rounded-lg border border-sand bg-cream">
          {reports.map((report) => (
            <article
              key={report.id}
              className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-subtle">
                  <FileCheck2
                    className="h-5 w-5 text-navy"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-dark">
                    {report.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-warm-mid">
                    {REPORT_TYPE_LABELS[report.type] ?? "Client report"}
                    {report.sent_at
                      ? ` · Sent ${formatDate(report.sent_at)}`
                      : " · Sent date not recorded"}
                  </p>
                </div>
              </div>
              <Link
                href={`/portal/documents/reports/${report.id}/print`}
                className="btn-secondary shrink-0"
              >
                Open print view
              </Link>
            </article>
          ))}
        </div>
      )}
    </ZoneFrame>
  );
}

export default async function PortalDocumentsPage() {
  const context = await getPortalClientPageContext();
  const canSeeRequests = tierHasFeature(context.tier, "evidence_requests");
  const canSeeVault = tierHasFeature(context.tier, "compliance_layer");
  const canSeeReports = tierHasFeature(context.tier, "monthly_reports");

  const requestPromise = canSeeRequests
    ? loadOpenRequests(
        context.supabase,
        context.clientId,
        tierHasFeature(context.tier, "compliance_layer")
      )
    : null;
  const documentPromise = canSeeVault
    ? loadDocuments(context.supabase, context.clientId)
    : null;
  const reportPromise = canSeeReports
    ? loadSentReports(context.supabase, context.clientId)
    : null;

  return (
    <div className="overflow-hidden">
      <PortalHeroBand
        eyebrow="Your shared workspace"
        title="Documents"
        description="Send what GEIA needs, keep your records organized, and open reports we have sent to your company."
      />
      <PortalSectionDivider transition="navy-to-warm" />

      <PortalPageBody contentClassName="space-y-12">
        <Suspense fallback={<ZoneSkeleton rows={2} />}>
          <NeededFromYouSection requestPromise={requestPromise} />
        </Suspense>
        <Suspense fallback={<ZoneSkeleton rows={3} />}>
          <VaultSection documentPromise={documentPromise} />
        </Suspense>
        <Suspense fallback={<ZoneSkeleton rows={2} />}>
          <FromGeiaSection reportPromise={reportPromise} />
        </Suspense>
      </PortalPageBody>

      <PortalSectionDivider transition="warm-to-navy" />
      <PortalFooterBand>
        <div>
          <p className="font-heading text-xl font-semibold tracking-tight text-warm-white">
            {context.clientName}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-warm-white/75">
          <span>USDOT {context.dotNumber}</span>
          <span>
            {context.mcNumber
              ? `MC ${context.mcNumber.replace(/^MC-?/i, "")}`
              : "MC not recorded"}
          </span>
        </div>
      </PortalFooterBand>
    </div>
  );
}
