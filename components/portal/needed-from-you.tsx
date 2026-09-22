import { portalCopy } from "@/lib/portal/copy";
import Link from "next/link";
import { CalendarClock, CircleCheck, FileCheck2, FolderOpen, LockKeyhole, MessageCircleQuestion } from "lucide-react";
import { PortalMotionArticle, PortalMotionSection } from "@/components/portal/motion";
import { RequestUpload } from "@/components/portal/request-upload";
import { RequestAnswer } from "@/components/portal/request-answer";
import { minimumTierForFeature, TIER_LABELS, type TierFeature } from "@/lib/tiers";
import type { LaneBEvidenceClass } from "@/lib/evidence-loop/taxonomy";
import type { ClientRequestRow } from "@/lib/portal/requests-types";
type RequestedEvidenceItem = {
  evidenceId: string | null;
  label: string;
  contextNote: string | null;
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
  if (request.request_type === "roster_collection") {
    return request.submitted_at
      ? {
          label: "List submitted",
          copy: "Your driver list is saved. You can still add or correct a driver until GEIA finishes its review.",
          tone: "navy" as const,
        }
      : {
          label: "Driver list needed",
          copy: "Open the secure link to add each driver and optional credential photos. Your work saves as you go.",
          tone: "amber" as const,
        };
  }

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

/** Keep distinct instructions while suppressing repeated sentences within a card. */
function uniqueRequestCopy(value: string | null | undefined, seen: Set<string>) {
  return portalCopy(value)
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const key = sentence.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
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

export async function NeededFromYouSection({
  requestPromise,
  requestFeatureLocked,
  hideWhenEmpty = false,
}: {
  requestPromise: Promise<ClientRequestRow[]>;
  requestFeatureLocked: boolean;
  hideWhenEmpty?: boolean;
}) {
  const requests = await requestPromise;
  if (hideWhenEmpty && requests.length === 0) return null;
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
            const status = statusPresentation(request);
            const seenCopy = new Set<string>();
            const description = uniqueRequestCopy(request.description, seenCopy);
            const whyCopy = uniqueRequestCopy(request.why_copy, seenCopy);
            const statusCopy = uniqueRequestCopy(status.copy, seenCopy);
            const items = requestedEvidenceItems(request.requested_items).map(
              (item) => ({
                ...item,
                contextNote: uniqueRequestCopy(item.contextNote, seenCopy),
              })
            );
            const isQuestion = request.request_type === "question";
            const isRosterCollection =
              request.request_type === "roster_collection";
            const isFmcsaPinRequest =
              request.category === "fmcsa_portal_pin";
            const lifecycleStatus =
              request.evidence_status ??
              (request.status === "open" ? "open" : request.status);
            const canUpload =
              !isQuestion &&
              !isRosterCollection &&
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
                      {portalCopy(request.title)}
                    </h3>
                    {description ? (
                      <p className="mt-1 text-sm leading-6 text-warm-mid">
                        {description}
                      </p>
                    ) : null}
                    {whyCopy || (!request.why_copy && request.potential_points !== null) ? (
                      <p className="mt-2 text-sm font-medium leading-6 text-amber-dark">
                        {whyCopy ? whyCopy :
                          `Evidence review covers ${request.potential_points} weighted point${
                            request.potential_points === 1 ? "" : "s"
                          }. Removal is not established.`}
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

                {statusCopy ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-sand bg-warm-white px-3 py-2.5">
                    <CircleCheck
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        status.tone === "green" ? "text-success" : "text-amber"
                      }`}
                      aria-hidden="true"
                    />
                    <p className="text-xs leading-5 text-warm-mid">
                      {statusCopy}
                    </p>
                  </div>
                ) : null}

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
                    question={portalCopy(request.title)}
                  />
                ) : null}

                {isRosterCollection ? (
                  <div className="mt-4 rounded-lg border border-gold/30 bg-amber-subtle/55 p-4">
                    <p className="text-sm font-semibold text-warm-dark">
                      Add names, CDL numbers, and optional photos in the secure driver-list page.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-warm-mid">
                      No extra password is needed. You can save a few drivers, leave, and come back with this link.
                    </p>
                    <Link
                      href={`/roster/${request.upload_token}`}
                      className="btn-primary mt-3 min-h-11 w-full text-sm sm:w-auto"
                    >
                      {request.submitted_at ? "Review or update driver list" : "Open driver list"}
                    </Link>
                  </div>
                ) : null}

                {!isQuestion && !isRosterCollection && items.length > 0 ? (
                  <div className="mt-4 divide-y divide-sand overflow-hidden rounded-lg border border-sand bg-warm-white">
                    {items.map((item, itemIndex) => (
                      <div
                        key={item.evidenceId ?? `${portalCopy(item.label)}-${itemIndex}`}
                        className="p-4"
                      >
                        <p className="text-sm font-semibold text-warm-dark">
                          {portalCopy(item.label)}
                        </p>
                        {item.contextNote ? (
                          <p className="mt-1 text-xs leading-5 text-warm-mid">
                            {portalCopy(item.contextNote)}
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
                ) : !isQuestion && !isRosterCollection && canUpload ? (
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
