import Link from "next/link";
import { Suspense } from "react";
import {
  CalendarClock,
  CircleCheck,
  FileCheck2,
  FolderOpen,
  LockKeyhole,
  MessageCircleQuestion,
} from "lucide-react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import {
  PortalMotionArticle,
  PortalMotionSection,
} from "@/components/portal/motion";
import { RequestUpload } from "@/components/portal/request-upload";
import { RequestAnswer } from "@/components/portal/request-answer";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";
import { getPortalClientPageContext } from "@/lib/portal/access";
import type { LaneBEvidenceClass } from "@/lib/evidence-loop/taxonomy";
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
  evidenceId: string | null;
  label: string;
  contextNote: string | null;
};

type ClientRequestType = "evidence" | "question";

type ClientRequestRow = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  requested_items: unknown;
  request_type: ClientRequestType | null;
  evidence_class: LaneBEvidenceClass | null;
  why_copy: string | null;
  potential_points: number | null;
  status: string;
  evidence_status: string | null;
  status_copy: string | null;
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

const EVIDENCE_CLASS_LABELS: Record<LaneBEvidenceClass, string> = {
  "wrong-attribution": "Wrong attribution",
  duplicate: "Duplicate record",
  "citation-dismissed": "Citation disposition",
  "report-factual-error": "Report factual error",
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Action needed",
  submitted: "Evidence received",
  applied: "Applied to your challenge",
  insufficient: "More evidence needed",
};

function statusPresentation(request: ClientRequestRow) {
  const lifecycleStatus =
    request.evidence_status ?? (request.status === "open" ? "open" : request.status);

  if (request.request_type === "question" && lifecycleStatus === "open") {
    return {
      label: "Answer needed",
      copy: request.status_copy ?? "Choose yes or no so we can take the right next step.",
      tone: "amber" as const,
    };
  }

  if (request.request_type === "question") {
    return {
      label: "Answered",
      copy: request.status_copy ?? "Your answer is recorded.",
      tone: "green" as const,
    };
  }

  const fallbackCopy: Record<string, string> = {
    open: "Upload the requested evidence so GEIA can evaluate the challenge.",
    submitted: "Evidence received. SafeScore is checking how it changes this challenge.",
    applied: "Evidence received — this strengthened your challenge.",
    insufficient:
      "We reviewed the evidence, but more support is needed before this challenge can move forward.",
  };

  return {
    label: REQUEST_STATUS_LABELS[lifecycleStatus] ?? "In progress",
    copy:
      request.status_copy ??
      fallbackCopy[lifecycleStatus] ??
      "GEIA is tracking this request.",
    tone:
      lifecycleStatus === "applied"
        ? ("green" as const)
        : lifecycleStatus === "submitted"
          ? ("navy" as const)
          : ("amber" as const),
  };
}

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
  return value.flatMap((item): RequestedEvidenceItem[] => {
    if (typeof item === "string" && item.trim()) {
      return [{ evidenceId: null, label: item.trim(), contextNote: null }];
    }
    if (
      typeof item !== "object" ||
      item === null ||
      !("label" in item) ||
      typeof item.label !== "string"
    ) {
      return [];
    }
    return [
      {
        evidenceId:
          "evidenceId" in item && typeof item.evidenceId === "string"
            ? item.evidenceId
            : "itemKey" in item && typeof item.itemKey === "string"
              ? item.itemKey
            : null,
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
  includeCompliance: boolean,
  includeEvidenceRequests: boolean
): Promise<ClientRequestRow[]> {
  let query = supabase
    .from("client_requests")
    .select(
      "id, category, title, description, requested_items, request_type, evidence_class, why_copy, potential_points, status, evidence_status, status_copy, due_at, created_at"
    )
    .eq("client_id", clientId)
    .eq("responsibility", "client")
    .neq("status", "cancelled")
    .or(
      "status.eq.open,evidence_status.in.(submitted,applied,insufficient)"
    );

  if (!includeCompliance) {
    query = query.not(
      "category",
      "in",
      "(mcs150_truth_up,dqf_roster,compliance_renewal)"
    );
  }
  if (!includeEvidenceRequests) {
    query = query.eq("category", "fmcsa_portal_pin");
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
    <PortalMotionSection
      interactive
      id={id}
      className="scroll-mt-28 rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-5">
        <h2 className="font-heading text-xl font-semibold text-warm-dark">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-warm-mid">{description}</p>
      </div>
      {children}
    </PortalMotionSection>
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
    <section
      aria-label="Loading documents"
      className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
      role="status"
    >
      <GoldenEraTruckLoader compact className="mx-auto mb-5" />
      <div className="space-y-2">
        <div className="h-6 w-44 rounded bg-sand motion-safe:animate-pulse" />
        <div className="h-4 w-full max-w-lg rounded bg-cream motion-safe:animate-pulse" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 rounded-lg border border-sand bg-cream p-4"
          >
            <div className="h-10 w-10 rounded bg-sand motion-safe:animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 rounded bg-sand motion-safe:animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-sand motion-safe:animate-pulse" />
            </div>
            <div className="h-8 w-24 rounded bg-sand motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading documents…</span>
    </section>
  );
}

async function NeededFromYouSection({
  requestPromise,
  requestFeatureLocked,
}: {
  requestPromise: Promise<ClientRequestRow[]>;
  requestFeatureLocked: boolean;
}) {
  const requests = await requestPromise;
  return (
    <ZoneFrame
      id="needed-from-you"
      title="Needed from you"
      description="Send the records only your team can provide. GEIA handles the rest."
    >
      {requests.length === 0 && requestFeatureLocked ? (
        <ZoneLocked
          feature="evidence_requests"
          title="Document requests are not included in your service plan"
        />
      ) : requests.length === 0 ? (
        <EmptyZone
          icon={FileCheck2}
          title="Nothing needed from you right now"
          description="When GEIA needs a record or document, the request and upload button will appear here."
        />
      ) : (
        <div className="space-y-4">
          {requests.map((request, index) => {
            const items = requestedEvidenceItems(request.requested_items);
            const status = statusPresentation(request);
            const isQuestion = request.request_type === "question";
            const isFmcsaPinRequest =
              request.category === "fmcsa_portal_pin";
            const lifecycleStatus =
              request.evidence_status ??
              (request.status === "open" ? "open" : request.status);
            const canUpload =
              !isQuestion &&
              !isFmcsaPinRequest &&
              (lifecycleStatus === "open" ||
                lifecycleStatus === "submitted" ||
                lifecycleStatus === "insufficient");
            const hasLegacyEvidenceSlots = items.some(
              (item) => item.evidenceId !== null
            );
            return (
              <PortalMotionArticle
                interactive
                key={request.id}
                className="rounded-lg border border-sand bg-cream p-4 shadow-sm sm:p-5"
                delay={Math.min(index * 0.06, 0.18)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {request.evidence_class ? (
                        <span className="rounded-full border border-sand bg-warm-white px-2.5 py-1 text-[11px] font-semibold text-navy">
                          {EVIDENCE_CLASS_LABELS[request.evidence_class]}
                        </span>
                      ) : null}
                      {isQuestion ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sand bg-warm-white px-2.5 py-1 text-[11px] font-semibold text-warm-mid">
                          <MessageCircleQuestion
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          Quick question
                        </span>
                      ) : null}
                    </div>
                    <h3 className="font-heading text-base font-semibold text-warm-dark">
                      {request.title}
                    </h3>
                    {request.description ? (
                      <p className="mt-1 text-sm leading-6 text-warm-mid">
                        {request.description}
                      </p>
                    ) : null}
                    {request.why_copy || request.potential_points !== null ? (
                      <p className="mt-2 text-sm font-medium leading-6 text-amber-dark">
                        {request.why_copy ??
                          `This could remove ${request.potential_points} point${
                            request.potential_points === 1 ? "" : "s"
                          }.`}
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
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      status.tone === "green"
                        ? "bg-success-light text-success"
                        : status.tone === "navy"
                          ? "bg-navy-subtle text-navy"
                          : "bg-amber-subtle text-amber-dark"
                    }`}
                  >
                    {status.label}
                  </span>
                </div>

                <div
                  className="mt-4 flex items-start gap-2 rounded-lg border border-sand bg-warm-white px-3 py-2.5"
                >
                  <CircleCheck
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      status.tone === "green" ? "text-success" : "text-amber"
                    }`}
                    aria-hidden="true"
                  />
                  <p className="text-xs leading-5 text-warm-mid">
                    {status.copy}
                  </p>
                </div>

                {isFmcsaPinRequest ? (
                  <div className="mt-4 rounded-lg border border-navy/15 bg-navy-subtle p-4">
                    <div className="flex items-start gap-3">
                      <LockKeyhole
                        className="mt-0.5 h-5 w-5 shrink-0 text-navy"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-sm font-semibold text-navy">
                          Where to find your PIN
                        </p>
                        <p className="mt-1 text-sm leading-6 text-warm-mid">
                          Log in to{" "}
                          <span className="font-mono text-xs">
                            ai.fmcsa.dot.gov
                          </span>{" "}
                          and look under profile settings.
                        </p>
                        <p className="mt-2 text-xs leading-5 text-warm-mid">
                          Do not send your PIN through ordinary email. Secure
                          online PIN handoff is not available yet; contact your
                          Golden Era SafeScore team for a secure handoff.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isQuestion && lifecycleStatus === "open" ? (
                  <RequestAnswer
                    requestId={request.id}
                    question={request.title}
                  />
                ) : null}

                {!isQuestion && items.length > 0 ? (
                  <div className="mt-4 divide-y divide-sand overflow-hidden rounded-lg border border-sand bg-warm-white">
                    {items.map((item, itemIndex) => (
                      <div
                        key={item.evidenceId ?? `${item.label}-${itemIndex}`}
                        className="p-4"
                      >
                        <p className="text-sm font-semibold text-warm-dark">
                          {item.label}
                        </p>
                        {item.contextNote ? (
                          <p className="mt-1 text-xs leading-5 text-warm-mid">
                            {item.contextNote}
                          </p>
                        ) : null}
                        {canUpload && item.evidenceId ? (
                          <RequestUpload
                            requestId={request.id}
                            evidenceId={item.evidenceId}
                            laneBEvidence={request.category === "lane_b_evidence"}
                          />
                        ) : null}
                      </div>
                    ))}
                    {canUpload && !hasLegacyEvidenceSlots ? (
                      <div className="p-4">
                        <RequestUpload requestId={request.id} laneBEvidence={request.category === "lane_b_evidence"} />
                      </div>
                    ) : null}
                  </div>
                ) : !isQuestion && canUpload ? (
                  <RequestUpload requestId={request.id} laneBEvidence={request.category === "lane_b_evidence"} />
                ) : null}
              </PortalMotionArticle>
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
          {reports.map((report, index) => (
            <PortalMotionArticle
              interactive
              key={report.id}
              className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
              delay={Math.min(index * 0.06, 0.18)}
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
            </PortalMotionArticle>
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

  const requestPromise = loadOpenRequests(
    context.supabase,
    context.clientId,
    tierHasFeature(context.tier, "compliance_layer"),
    canSeeRequests
  );
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
          <NeededFromYouSection
            requestPromise={requestPromise}
            requestFeatureLocked={!canSeeRequests}
          />
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
