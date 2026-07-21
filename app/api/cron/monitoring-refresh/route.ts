import { NextResponse } from "next/server";
import { runChallengeabilityAssessment } from "@/lib/analysis/challengeability-assessment-server";
import {
  emitRefreshAlerts,
  sendRefreshViolationEmails,
} from "@/lib/monitoring/alerts";
import { runClientRefresh } from "@/lib/monitoring/run-client-refresh";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ActiveClient = {
  id: string;
  name: string;
  dot_number: string;
};

type CronSummary = {
  clients_processed: number;
  new_violations: number;
  new_crashes: number;
  snapshots_created: number;
  alerts_created: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, dot_number")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: `Unable to load active clients: ${error.message}` },
      { status: 500 }
    );
  }

  const summary: CronSummary = {
    clients_processed: 0,
    new_violations: 0,
    new_crashes: 0,
    snapshots_created: 0,
    alerts_created: 0,
  };
  const errors: Array<{ client_id: string; error: string }> = [];

  for (const client of (data ?? []) as ActiveClient[]) {
    try {
      const refresh = await runClientRefresh(
        { clientId: client.id, dotNumber: client.dot_number },
        supabase
      );
      summary.new_violations += refresh.newViolationIds.length;
      summary.new_crashes += refresh.newCrashIds.length;
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
        newCrashIds: refresh.newCrashIds,
      });
      summary.alerts_created += emittedAlerts.created.length;

      const assessmentErrors: string[] = [];
      for (const violationId of refresh.newViolationIds) {
        try {
          const assessment = await runChallengeabilityAssessment(supabase, client.id, {
            violationIds: [violationId],
          });
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
          `${refresh.newViolationIds.length} new violations; ${refresh.newCrashIds.length} new crashes; ` +
          `snapshot ${snapshotTaken ? "taken" : "skipped"}; ${emittedAlerts.created.length} alerts created.`,
        metadata: {
          source: "monitoring_cron",
          new_inspections: refresh.newInspectionCount,
          snapshot_status: snapshot.status,
          alerts_created: emittedAlerts.created.length,
          assessment_errors: assessmentErrors,
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

  return NextResponse.json(errors.length > 0 ? { ...summary, errors } : summary);
}
