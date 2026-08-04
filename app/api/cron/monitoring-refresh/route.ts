import { NextResponse } from "next/server";
import { runChallengeabilityAssessment } from "@/lib/analysis/challengeability-assessment-server";
import {
  emitRefreshAlerts,
  sendRefreshViolationEmails,
} from "@/lib/monitoring/alerts";
import { runClientRefresh } from "@/lib/monitoring/run-client-refresh";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
import { shouldRunMonitoringInvocation } from "@/lib/monitoring/watch-status";
import {
  runMcs150TruthUp,
  type Mcs150TruthUpRunResult,
} from "@/lib/mcs150/truth-up-server";
import {
  refreshCarrierProfileEnrichment,
  type CarrierProfileEnrichmentResult,
} from "@/lib/fmcsa/carrier-profile-enrichment-server";
import { createServiceClient } from "@/lib/supabase/server";
import type { ClientTier } from "@/lib/supabase/types";
import { SUBSCRIPTION_TIERS, tierHasFeature } from "@/lib/tiers";
import { reconcileLaneBEvidenceLoopForClient } from "@/lib/evidence-loop/server";
import { closeAgedOutEvidenceRequests } from "@/lib/evidence-loop/age-out";
import { retrySubmittedLaneBEvidenceRequests } from "@/lib/challengeability/reassess-on-change";
import { notifyOperations } from "@/lib/notifications/operations";
import { runDueClientRequestReminders } from "@/lib/request-queue/reminders";
import type { ClientRequestReminderRunResult } from "@/lib/request-queue/reminder-processor";
import {
  runComplianceExpirationSweep,
  type ComplianceExpirationSweepResult,
} from "@/lib/compliance/expiration-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ActiveClient = {
  id: string;
  name: string;
  dot_number: string;
  tier: ClientTier;
};

type CronSummary = {
  clients_processed: number;
  new_inspections: number;
  new_violations: number;
  new_crashes: number;
  oos_changes: number;
  snapshots_created: number;
  alerts_created: number;
  operations_notifications_logged: number;
  mcs150_checks_succeeded: number;
  mcs150_requests_created: number;
  mcs150_updates_confirmed: number;
  carrier_enrichment_sources_attempted: number;
  carrier_enrichment_sources_succeeded: number;
  carrier_enrichment_sources_failed: number;
  lane_b_requests_created: number;
  lane_b_requests_aged_out: number;
  lane_b_intake_questions_created: number;
  lane_b_evidence_retries_attempted: number;
  lane_b_evidence_retries_completed: number;
  compliance_checks_succeeded: number;
  compliance_checks_skipped: number;
  compliance_events_created: number;
  compliance_alerts_created: number;
  compliance_requests_created: number;
  compliance_digests_logged: number;
  request_reminders_processed: number;
  request_reminders_sent: number;
  request_reminders_dry_run: number;
  request_reminders_failed: number;
};

type Mcs150CronResult = {
  client_id: string;
  result: Mcs150TruthUpRunResult;
};

type CarrierEnrichmentCronResult = {
  client_id: string;
  result: CarrierProfileEnrichmentResult;
};

type ComplianceCronResult = {
  client_id: string;
  result: ComplianceExpirationSweepResult;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scheduleHeader = request.headers.get("x-vercel-cron-schedule");
  if (
    !shouldRunMonitoringInvocation({
      scheduleHeader,
      userAgent: request.headers.get("user-agent"),
    })
  ) {
    return NextResponse.json({
      skipped: true,
      reason: "outside_6am_pacific",
      schedule: scheduleHeader,
    });
  }

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, dot_number, tier")
    .eq("status", "active")
    .in("tier", [...SUBSCRIPTION_TIERS])
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: `Unable to load active clients: ${error.message}` },
      { status: 500 }
    );
  }

  const summary: CronSummary = {
    clients_processed: 0,
    new_inspections: 0,
    new_violations: 0,
    new_crashes: 0,
    oos_changes: 0,
    snapshots_created: 0,
    alerts_created: 0,
    operations_notifications_logged: 0,
    mcs150_checks_succeeded: 0,
    mcs150_requests_created: 0,
    mcs150_updates_confirmed: 0,
    carrier_enrichment_sources_attempted: 0,
    carrier_enrichment_sources_succeeded: 0,
    carrier_enrichment_sources_failed: 0,
    lane_b_requests_created: 0,
    lane_b_requests_aged_out: 0,
    lane_b_intake_questions_created: 0,
    lane_b_evidence_retries_attempted: 0,
    lane_b_evidence_retries_completed: 0,
    compliance_checks_succeeded: 0,
    compliance_checks_skipped: 0,
    compliance_events_created: 0,
    compliance_alerts_created: 0,
    compliance_requests_created: 0,
    compliance_digests_logged: 0,
    request_reminders_processed: 0,
    request_reminders_sent: 0,
    request_reminders_dry_run: 0,
    request_reminders_failed: 0,
  };
  const errors: Array<{ client_id: string; error: string }> = [];
  const mcs150Results: Mcs150CronResult[] = [];
  const carrierEnrichmentResults: CarrierEnrichmentCronResult[] = [];
  const complianceResults: ComplianceCronResult[] = [];
  let requestReminderResults: ClientRequestReminderRunResult | null = null;

  // Process the lightweight request queue before public-source refreshes so a
  // slow FMCSA client cannot starve reminders at the end of the cron window.
  try {
    requestReminderResults = await runDueClientRequestReminders(supabase, {
      source: "monitoring_cron",
    });
    summary.request_reminders_processed = requestReminderResults.processed;
    summary.request_reminders_sent = requestReminderResults.sent;
    summary.request_reminders_dry_run = requestReminderResults.dryRun;
    summary.request_reminders_failed = requestReminderResults.failed;
    for (const reminder of requestReminderResults.results) {
      if (reminder.status !== "failed") continue;
      errors.push({
        client_id: reminder.clientId,
        error: `Client request reminder ${reminder.requestId}: ${
          reminder.reason ?? "failed"
        }`,
      });
    }
  } catch (reminderError) {
    summary.request_reminders_failed += 1;
    errors.push({
      client_id: "request_reminders",
      error: `Client request reminders: ${errorMessage(reminderError)}`,
    });
  }

  for (const client of (data ?? []) as ActiveClient[]) {
    try {
      const shouldAssessChallengeability = tierHasFeature(
        client.tier,
        "case_visibility"
      );
      const hasComplianceLayer = tierHasFeature(
        client.tier,
        "compliance_layer"
      );
      const hasEvidenceRequests = tierHasFeature(
        client.tier,
        "evidence_requests"
      );
      let mcs150TruthUp: Mcs150TruthUpRunResult | null = null;
      let mcs150TruthUpError: string | null = null;
      let carrierEnrichment: CarrierProfileEnrichmentResult | null = null;
      let complianceSweep: ComplianceExpirationSweepResult | null = null;
      let complianceSweepError: string | null = null;
      let laneBEvidenceAgeOut: Awaited<
        ReturnType<typeof closeAgedOutEvidenceRequests>
      > | null = null;

      // Total Safety expiration tracking is independent of the FMCSA refresh.
      // Run it first and isolate failures so an external-source outage cannot
      // suppress credential, inspection, MVR, or Clearinghouse reminders.
      if (hasComplianceLayer) {
        try {
          complianceSweep = await runComplianceExpirationSweep(supabase, {
            clientId: client.id,
          });
          complianceResults.push({
            client_id: client.id,
            result: complianceSweep,
          });
          if (complianceSweep.status === "succeeded") {
            summary.compliance_checks_succeeded += 1;
          } else {
            summary.compliance_checks_skipped += 1;
          }
          summary.compliance_events_created += complianceSweep.eventsCreated;
          summary.compliance_alerts_created += complianceSweep.alertsCreated;
          summary.compliance_requests_created += complianceSweep.requestsCreated;
          if (
            complianceSweep.operationsNotification === "dry_run" ||
            complianceSweep.operationsNotification === "sent"
          ) {
            summary.compliance_digests_logged += 1;
            summary.operations_notifications_logged += 1;
          }
        } catch (sweepError) {
          complianceSweepError = errorMessage(sweepError);
          errors.push({
            client_id: client.id,
            error: `Compliance expiration sweep failed: ${complianceSweepError}`,
          });
        }
      }

      const refresh = await runClientRefresh(
        { clientId: client.id, dotNumber: client.dot_number },
        supabase
      );
      summary.new_inspections += refresh.newInspectionIds.length;
      summary.new_violations += refresh.newViolationIds.length;
      summary.new_crashes += refresh.newCrashIds.length;
      summary.oos_changes += refresh.oosRateChange ? 1 : 0;
      // Tier changes do not erase historical requests. Close aged-out work for
      // every monitored subscription client, including a client downgraded
      // below the evidence-request feature after a request was created.
      laneBEvidenceAgeOut = await closeAgedOutEvidenceRequests(supabase, {
        clientId: client.id,
        trigger: "monitoring_cron",
      });
      summary.lane_b_requests_aged_out +=
        laneBEvidenceAgeOut.closedRequestIds.length;
      try {
        carrierEnrichment = await refreshCarrierProfileEnrichment(
          {
            clientId: client.id,
            dotNumber: client.dot_number,
            trigger: "scheduled",
            freshSafer: refresh.saferSnapshot,
          },
          supabase,
        );
        carrierEnrichmentResults.push({
          client_id: client.id,
          result: carrierEnrichment,
        });
        const attempted = carrierEnrichment.sources.filter(
          (source) => source.status !== "skipped",
        );
        summary.carrier_enrichment_sources_attempted += attempted.length;
        summary.carrier_enrichment_sources_succeeded += attempted.filter(
          (source) => source.status === "succeeded",
        ).length;
        summary.carrier_enrichment_sources_failed += attempted.filter(
          (source) => source.status === "failed",
        ).length;
        for (const source of attempted.filter(
          (item) => item.status === "failed",
        )) {
          errors.push({
            client_id: client.id,
            error: `Carrier-profile ${source.source} enrichment failed: ${source.reason}`,
          });
        }
      } catch (enrichmentError) {
        summary.carrier_enrichment_sources_failed += 1;
        errors.push({
          client_id: client.id,
          error: `Carrier-profile enrichment failed: ${errorMessage(
            enrichmentError,
          )}`,
        });
      }
      if (hasComplianceLayer) {
        try {
          mcs150TruthUp = await runMcs150TruthUp(
            {
              clientId: client.id,
              clientName: client.name,
              dotNumber: client.dot_number,
              complianceIncluded: true,
              freshCensus: refresh.saferSnapshot,
              burdenPoints: refresh.burden.totalPoints,
            },
            supabase
          );
          mcs150Results.push({ client_id: client.id, result: mcs150TruthUp });
          summary.mcs150_checks_succeeded +=
            mcs150TruthUp.quarterly.status === "succeeded" ? 1 : 0;
          summary.mcs150_requests_created +=
            mcs150TruthUp.quarterly.artifactsCreated ? 1 : 0;
          summary.mcs150_updates_confirmed +=
            mcs150TruthUp.reconciliation.confirmedUpdateIds.length;
          if (mcs150TruthUp.quarterly.status === "failed") {
            mcs150TruthUpError = mcs150TruthUp.quarterly.reason;
            errors.push({
              client_id: client.id,
              error: `MCS-150 truth-up check failed: ${mcs150TruthUpError}`,
            });
          }
        } catch (truthUpError) {
          mcs150TruthUpError = errorMessage(truthUpError);
          errors.push({
            client_id: client.id,
            error: `MCS-150 truth-up check failed: ${mcs150TruthUpError}`,
          });
        }
      }
      const snapshot = await captureBurdenSnapshot(
        client.id,
        "scheduled_refresh",
        supabase
      );
      const snapshotTaken = snapshot.status === "inserted";
      summary.snapshots_created += snapshotTaken ? 1 : 0;
      const emittedAlerts = await emitRefreshAlerts(supabase, {
        clientId: client.id,
        newViolationIds: refresh.newViolationIds,
        newInspectionIds: refresh.newInspectionIds,
        newCrashIds: refresh.newCrashIds,
        oosRateChange: refresh.oosRateChange,
      });
      summary.alerts_created += emittedAlerts.created.length;
      if (emittedAlerts.created.length > 0) {
        const baseUrl = (
          process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
        ).replace(/\/+$/, "");
        const alertTypes = [
          ...new Set(emittedAlerts.created.map((alert) => alert.type)),
        ];
        await notifyOperations(supabase, {
          clientId: client.id,
          event: "monitoring_alert_raised",
          entityType: "clients",
          entityId: client.id,
          description: "Daily monitoring alert notification recorded for operations",
          email: {
            trigger: "staff_monitoring_alert",
            subject: `SafeScore monitoring alert — ${client.name} (${emittedAlerts.created.length})`,
            heading: "Daily monitoring found a safety-record change",
            message: `${client.name} has ${emittedAlerts.created.length} new monitoring ${
              emittedAlerts.created.length === 1 ? "alert" : "alerts"
            } for operations to review.`,
            consoleUrl: `${baseUrl}/console/clients/${client.id}/monitoring`,
            ctaLabel: "Review monitoring",
            details: [
              { label: "Company", value: client.name },
              { label: "USDOT", value: client.dot_number },
              {
                label: "Alert types",
                value: alertTypes
                  .map((type) => type.replaceAll("_", " "))
                  .join(", "),
              },
              {
                label: "Alerts",
                value: emittedAlerts.created
                  .map((alert) => alert.title)
                  .join("; "),
              },
            ],
          },
          metadata: {
            alert_ids: emittedAlerts.created.map((alert) => alert.id),
            alert_types: alertTypes,
          },
        });
        summary.operations_notifications_logged += 1;
      }

      const assessmentErrors: string[] = [];
      // Challengeability feeds Remediate case work. Monitor intentionally stops
      // after refresh, snapshot, alert creation, and client notification.
      if (shouldAssessChallengeability) {
        for (const violationId of refresh.newViolationIds) {
          try {
            const assessment = await runChallengeabilityAssessment(
              supabase,
              client.id,
              { violationIds: [violationId] }
            );
            if (assessment.failures.length > 0 || assessment.assessed !== 1) {
              assessmentErrors.push(
                `violation ${violationId}: ${assessment.failures
                  .map((failure) => failure.error)
                  .join("; ") || "no assessment was persisted"}`
              );
            }
          } catch (assessmentError) {
            assessmentErrors.push(
              `violation ${violationId}: ${errorMessage(assessmentError)}`
            );
          }
        }
      }

      let laneBEvidenceLoop: Awaited<
        ReturnType<typeof reconcileLaneBEvidenceLoopForClient>
      > | null = null;
      let laneBEvidenceRetry: Awaited<
        ReturnType<typeof retrySubmittedLaneBEvidenceRequests>
      > | null = null;
      if (hasEvidenceRequests) {
        try {
          laneBEvidenceLoop = await reconcileLaneBEvidenceLoopForClient(
            supabase,
            { clientId: client.id, trigger: "monitoring_cron" }
          );
          summary.lane_b_requests_created +=
            laneBEvidenceLoop.createdRequestIds.length;
          summary.lane_b_intake_questions_created +=
            laneBEvidenceLoop.intakeQuestionCreated ? 1 : 0;
          if (laneBEvidenceLoop.errors.length > 0) {
            assessmentErrors.push(
              `evidence requests: ${laneBEvidenceLoop.errors.join(" | ")}`
            );
          }
          laneBEvidenceRetry = await retrySubmittedLaneBEvidenceRequests(
            supabase,
            client.id,
            5
          );
          summary.lane_b_evidence_retries_attempted +=
            laneBEvidenceRetry.attempted;
          summary.lane_b_evidence_retries_completed +=
            laneBEvidenceRetry.completedRequestIds.length;
          if (laneBEvidenceRetry.errors.length > 0) {
            assessmentErrors.push(
              `evidence retries: ${laneBEvidenceRetry.errors.join(" | ")}`
            );
          }
        } catch (laneBError) {
          assessmentErrors.push(
            `evidence loop: ${errorMessage(laneBError)}`
          );
        }
      }

      await sendRefreshViolationEmails(supabase, {
        ...emittedAlerts,
        companyName: client.name,
        dotNumber: client.dot_number,
      });

      const { error: activityError } = await supabase.from("activity_log").insert({
        client_id: client.id,
        action_type: "data_imported",
        entity_type: "clients",
        entity_id: client.id,
        description:
          `Scheduled monitoring refresh: ${refresh.inspectionsPulled} inspections pulled; ` +
          `${refresh.newInspectionIds.length} new inspections; ${refresh.newViolationIds.length} new violations; ` +
          `${refresh.newCrashIds.length} new crashes; ${refresh.oosRateChange ? 1 : 0} OOS changes; ` +
          `snapshot ${snapshotTaken ? "taken" : "skipped"}; ${emittedAlerts.created.length} alerts created.`,
        metadata: {
          source: "monitoring_cron",
          source_status: refresh.sourceStatus,
          new_inspections: refresh.newInspectionIds.length,
          oos_rate_changes: refresh.oosRateChange?.changes ?? [],
          snapshot_status: snapshot.status,
          alerts_created: emittedAlerts.created.length,
          operations_notification:
            emittedAlerts.created.length > 0 ? "logged" : "not_needed",
          subscription_tier: client.tier,
          challengeability_assessment: shouldAssessChallengeability
            ? "run"
            : "not_included",
          assessment_errors: assessmentErrors,
          lane_b_evidence_loop: hasEvidenceRequests
            ? {
                requests_created:
                  laneBEvidenceLoop?.createdRequestIds.length ?? 0,
                requests_existing:
                  laneBEvidenceLoop?.existingRequestIds.length ?? 0,
                requests_aged_out:
                  laneBEvidenceAgeOut?.closedRequestIds.length ?? 0,
                intake_question_created:
                  laneBEvidenceLoop?.intakeQuestionCreated ?? false,
                evidence_retries_attempted:
                  laneBEvidenceRetry?.attempted ?? 0,
                evidence_retries_completed:
                  laneBEvidenceRetry?.completedRequestIds.length ?? 0,
              }
            : "not_included",
          carrier_profile_enrichment:
            carrierEnrichment?.sources.map((source) => ({
              source: source.source,
              status: source.status,
              reason: source.reason,
              row_id: source.row?.id ?? null,
            })) ?? null,
          compliance_expiration_sweep: hasComplianceLayer
            ? complianceSweep ?? {
                status: "failed",
                reason: complianceSweepError,
              }
            : "not_included",
        },
      });
      if (activityError) {
        throw new Error(`Unable to write monitoring activity: ${activityError.message}`);
      }

      summary.clients_processed += 1;
      if (assessmentErrors.length > 0) {
        const message = `Incremental challengeability errors: ${assessmentErrors.join(" | ")}`;
        console.error(`[monitoring-refresh] Client ${client.id}:`, message);
        errors.push({ client_id: client.id, error: message });
      }
    } catch (clientError) {
      const message = errorMessage(clientError);
      console.error(`[monitoring-refresh] Client ${client.id} failed:`, message);
      errors.push({ client_id: client.id, error: message });
    }
  }

  return NextResponse.json(
    errors.length > 0
      ? {
          ...summary,
          mcs150_results: mcs150Results,
          carrier_enrichment_results: carrierEnrichmentResults,
          compliance_results: complianceResults,
          request_reminder_results: requestReminderResults,
          errors,
        }
      : {
          ...summary,
          mcs150_results: mcs150Results,
          carrier_enrichment_results: carrierEnrichmentResults,
          compliance_results: complianceResults,
          request_reminder_results: requestReminderResults,
        }
  );
}
