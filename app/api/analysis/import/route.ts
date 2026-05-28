import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getBasics,
  getOosRates,
  getInspections,
  getCrashes,
} from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";
import { z } from "zod";

// Direct service-role client — no SSR cookie layer, definitively bypasses RLS.
function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const schema = z.object({
  clientId: z.string().uuid(),
  dotNumber: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, dotNumber } = parsed.data;
  const supabase = getAdmin();

  try {
    // ── 1. Fetch BASIC scores + OOS rates ────────────────────────────────────
    const [basics, oos] = await Promise.all([
      getBasics(dotNumber),
      getOosRates(dotNumber),
    ]);

    // ── 2. Upsert score snapshot for today ───────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const { error: snapshotErr } = await supabase
      .from("score_snapshots")
      .upsert(
        {
          client_id: clientId,
          snapshot_date: today,
          unsafe_driving_measure: basics.unsafeDriving?.measureValue ?? null,
          unsafe_driving_pct: basics.unsafeDriving?.percentile ?? null,
          hos_compliance_measure: basics.hosCompliance?.measureValue ?? null,
          hos_compliance_pct: basics.hosCompliance?.percentile ?? null,
          driver_fitness_measure: basics.driverFitness?.measureValue ?? null,
          driver_fitness_pct: basics.driverFitness?.percentile ?? null,
          controlled_substance_measure:
            basics.controlledSubstances?.measureValue ?? null,
          controlled_substance_pct:
            basics.controlledSubstances?.percentile ?? null,
          vehicle_maint_measure:
            basics.vehicleMaintenance?.measureValue ?? null,
          vehicle_maint_pct: basics.vehicleMaintenance?.percentile ?? null,
          hm_compliance_measure: basics.hmCompliance?.measureValue ?? null,
          hm_compliance_pct: basics.hmCompliance?.percentile ?? null,
          crash_indicator_measure:
            basics.crashIndicator?.measureValue ?? null,
          crash_indicator_pct: basics.crashIndicator?.percentile ?? null,
          oos_vehicle_rate: oos.vehicleOosRate ?? null,
          oos_driver_rate: oos.driverOosRate ?? null,
          oos_hazmat_rate: oos.hazmatOosRate ?? null,
          source: "api",
        },
        { onConflict: "client_id,snapshot_date" }
      );

    if (snapshotErr) {
      console.error(
        "Score snapshot upsert failed:",
        snapshotErr.code,
        snapshotErr.message,
        snapshotErr.details,
        snapshotErr.hint
      );
    } else {
      console.log(`Score snapshot upserted for client ${clientId} on ${today}. Measures: unsafe=${basics.unsafeDriving?.measureValue ?? "null"}, vehicle=${basics.vehicleMaintenance?.measureValue ?? "null"}`);
    }

    // ── 3. Non-destructive inspection + violation import ─────────────────────
    // Inspections: upsert on UNIQUE(client_id, report_number) — preserves IDs
    // Violations:  update in place if same violation_code+inspection_id exists,
    //              preserving AI assessments (challengeable, challenge_reason,
    //              challenge_priority). New violations are inserted fresh.
    // DataQ cases are NEVER deleted — their violation_id/inspection_id FKs
    // remain intact because we never drop the rows they reference.

    const inspections = await getInspections(dotNumber);
    let violationCount = 0;
    let newViolationCount = 0;

    // Pre-load existing violations for this client so we can diff by
    // (inspection_id, violation_code) without N+1 queries.
    const { data: existingViolations } = await supabase
      .from("violations")
      .select("id, inspection_id, violation_code, challengeable, challenge_reason, challenge_priority, ai_assessed_at")
      .eq("client_id", clientId);

    // Map key: "<inspection_uuid>:<violation_code>"
    type ExistingViol = {
      id: string;
      inspection_id: string;
      violation_code: string;
      challengeable: boolean | null;
      challenge_reason: string | null;
      challenge_priority: string | null;
      ai_assessed_at: string | null;
    };
    const existingViolMap = new Map<string, ExistingViol>();
    for (const v of (existingViolations ?? []) as ExistingViol[]) {
      existingViolMap.set(`${v.inspection_id}:${v.violation_code}`, v);
    }

    for (const insp of inspections) {
      // Upsert inspection — conflict on (client_id, report_number).
      // The existing row's UUID is preserved; Supabase returns it after upsert.
      const { data: inspRow, error: inspErr } = await supabase
        .from("inspections")
        .upsert(
          {
            client_id: clientId,
            dot_number: dotNumber,
            report_number: insp.reportNumber,
            inspection_date: insp.inspectionDate,
            state: insp.state,
            level: insp.level,
            facility_name: insp.facilityName,
            time_weight: insp.timeWeight,
            total_violations: insp.violations.length,
            oos_violations: insp.violations.filter((v) => v.oosViolation).length,
          },
          { onConflict: "client_id,report_number" }
        )
        .select("id")
        .single();

      if (inspErr || !inspRow) {
        console.error("Inspection upsert failed:", inspErr?.message);
        continue;
      }

      for (const viol of insp.violations) {
        const mapKey = `${inspRow.id}:${viol.violationCode}`;
        const existing = existingViolMap.get(mapKey);

        if (existing) {
          // Violation already exists — update non-AI fields only.
          // AI assessment fields (challengeable, challenge_reason,
          // challenge_priority, ai_assessed_at) are left untouched so
          // any DataQ work already done is preserved.
          const { error: violErr } = await supabase
            .from("violations")
            .update({
              violation_description: viol.description,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              basic_category: viol.basicCategory as any,
              severity_weight: viol.severityWeight,
              time_weight: insp.timeWeight,
              oos_violation: viol.oosViolation,
              convicted: viol.convicted,
              citation_number: viol.citationNumber ?? null,
            })
            .eq("id", existing.id);

          if (violErr) {
            console.error("Violation update failed:", violErr.message);
          } else {
            violationCount++;
          }
        } else {
          // New violation — insert fresh.
          const { error: violErr } = await supabase.from("violations").insert({
            inspection_id: inspRow.id,
            client_id: clientId,
            violation_code: viol.violationCode,
            violation_description: viol.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            basic_category: viol.basicCategory as any,
            severity_weight: viol.severityWeight,
            time_weight: insp.timeWeight,
            oos_violation: viol.oosViolation,
            convicted: viol.convicted,
            citation_number: viol.citationNumber ?? null,
            challengeable: null, // pending AI assessment
          });

          if (violErr) {
            console.error("Violation insert failed:", violErr.message);
          } else {
            violationCount++;
            newViolationCount++;
          }
        }
      }
    }

    // ── 4. Non-destructive crash import ──────────────────────────────────────
    // Match by report_number. Preserve cpdp_eligible + ai_assessed_at.
    // Never delete crashes — cpdp_cases FK would cascade.

    const crashes = await getCrashes(dotNumber);

    const { data: existingCrashes } = await supabase
      .from("crashes")
      .select("id, report_number")
      .eq("client_id", clientId);

    const existingCrashMap = new Map<string, string>(); // report_number → id
    for (const c of existingCrashes ?? []) {
      if (c.report_number) existingCrashMap.set(c.report_number, c.id);
    }

    for (const crash of crashes) {
      const existingId = crash.reportNumber
        ? existingCrashMap.get(crash.reportNumber)
        : undefined;

      if (existingId) {
        // Update non-AI fields; preserve cpdp_eligible, cpdp_eligible_types, ai_assessed_at
        const { error: crashErr } = await supabase
          .from("crashes")
          .update({
            crash_date: crash.crashDate,
            state: crash.state,
            city: crash.city,
            fatalities: crash.fatalities,
            injuries: crash.injuries,
            tow_away: crash.towAway,
            hazmat_release: crash.hazmatRelease,
          })
          .eq("id", existingId);

        if (crashErr) {
          console.error("Crash update failed:", crashErr.message);
        }
      } else {
        const { error: crashErr } = await supabase.from("crashes").insert({
          client_id: clientId,
          dot_number: dotNumber,
          report_number: crash.reportNumber,
          crash_date: crash.crashDate,
          state: crash.state,
          city: crash.city,
          fatalities: crash.fatalities,
          injuries: crash.injuries,
          tow_away: crash.towAway,
          hazmat_release: crash.hazmatRelease,
          preventable: null,
          cpdp_eligible: null,
          raw_data: {},
        });

        if (crashErr) {
          console.error("Crash insert failed:", crashErr.message);
        }
      }
    }

    // ── 5. Re-link orphaned DataQ cases ──────────────────────────────────────
    // If a previous destructive run set violation_id/inspection_id to NULL on
    // any DataQ cases, attempt to re-link them to a challengeable violation.
    // Best-effort: matches on priority; corrects the most common orphan scenario.
    const { data: orphanedCases } = await supabase
      .from("dataq_cases")
      .select("id, priority")
      .eq("client_id", clientId)
      .is("violation_id", null);

    if (orphanedCases && orphanedCases.length > 0) {
      const { data: challengeableViolations } = await supabase
        .from("violations")
        .select("id, challenge_priority, inspection_id")
        .eq("client_id", clientId)
        .eq("challengeable", true);

      if (challengeableViolations && challengeableViolations.length > 0) {
        const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const candidates = [...challengeableViolations].sort(
          (a, b) =>
            (priorityOrder[a.challenge_priority ?? "low"] ?? 2) -
            (priorityOrder[b.challenge_priority ?? "low"] ?? 2)
        );

        // Track which violation UUIDs we've already assigned
        const usedViolIds = new Set<string>();

        for (const orphan of orphanedCases) {
          // Prefer a violation with matching priority
          const match =
            candidates.find(
              (v) =>
                !usedViolIds.has(v.id) &&
                v.challenge_priority === orphan.priority
            ) ?? candidates.find((v) => !usedViolIds.has(v.id));

          if (match) {
            await supabase
              .from("dataq_cases")
              .update({
                violation_id: match.id,
                inspection_id: match.inspection_id,
                updated_at: new Date().toISOString(),
              })
              .eq("id", orphan.id);

            usedViolIds.add(match.id);
            console.log(
              `Re-linked orphaned DataQ case ${orphan.id} → violation ${match.id}`
            );
          }
        }
      }
    }

    // ── 6. Activate client if still in onboarding or prospect status ─────────
    await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId)
      .in("status", ["onboarding", "prospect"]);

    // ── 7. Log activity ──────────────────────────────────────────────────────
    await supabase.from("activity_log").insert({
      client_id: clientId,
      action_type: "data_imported",
      entity_type: "client",
      description: `Full analysis run: ${inspections.length} inspections, ${violationCount} violations (${newViolationCount} new), ${crashes.length} crashes processed. BASIC scores updated.`,
    });

    return NextResponse.json({
      success: true,
      inspections: inspections.length,
      violations: violationCount,
      newViolations: newViolationCount,
      crashes: crashes.length,
    });
  } catch (err) {
    console.error("Analysis import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
