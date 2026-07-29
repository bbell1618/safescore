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
  mcs150_checks_succeeded: number;
  mcs150_requests_created: number;
  mcs150_updates_confirmed: number;
  carrier_enrichment_sources_attempted: number;
  carrier_enrichment_sources_succeeded: number;
  carrier_enrichment_sources_failed: number;
};

type Mcs150CronResult = {
  client_id: string;
  result: Mcs150TruthUpRunResult;
};

type CarrierEnrichmentCronResult = {
  client_id: string;
  result: CarrierProfileEnrichmentResult;
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
    mcs150_checks_succeeded: 0,
    mcs150_requests_created: 0,
    mcs150_updates_confirmed: 0,
    carrier_enrichment_sources_attempted: 0,
    carrier_enrichment_sources_succeeded: 0,
    carrier_enrichment_sources_failed: 0,
  };
  const errors: Array<{ client_id: string; error: string }> = [];
  const mcs150Results: Mcs150CronResult[] = [];
  const carrierEnrichmentResults: CarrierEnrichmentCronResult[] = [];

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
      let mcs150TruthUp: Mcs150TruthUpRunResult | null = null;
      let mcs150TruthUpError: string | null = null;
      let carrierEnrichment: CarrierProfileEnrichmentResult | null = null;
      const refresh = await runClientRefresh(
        { clientId: client.id, dotNumber: client.dot_number },
        supabase
      );
      summary.new_inspections += refresh.newInspectionIds.length;
      summary.new_violations += refresh.newViolationIds.length;
      summary.new_crashes += refresh.newCrashIds.length;
      summary.oos_changes += refresh.oosRateChange ? 1 : 0;
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
          new_inspections: refresh.newInspectionIds.length,
          oos_rate_changes: refresh.oosRateChange?.changes ?? [],
          snapshot_status: snapshot.status,
          alerts_created: emittedAlerts.created.length,
          subscription_tier: client.tier,
          challengeability_assessment: shouldAssessChallengeability
            ? "run"
            : "not_included",
          assessment_errors: assessmentErrors,
          carrier_profile_enrichment:
            carrierEnrichment?.sources.map((source) => ({
              source: source.source,
              status: source.status,
              reason: source.reason,
              row_id: source.row?.id ?? null,
            })) ?? null,
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
          errors,
        }
      : {
          ...summary,
          mcs150_results: mcs150Results,
          carrier_enrichment_results: carrierEnrichmentResults,
        }
  );
}
