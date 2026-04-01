import { createServiceClient } from "@/lib/supabase/server";
import {
  getBasics,
  getOosRates,
  getInspections,
  getCrashes,
} from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";
import { z } from "zod";

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
  const supabase = await createServiceClient();

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
      console.error("Score snapshot upsert failed:", snapshotErr);
    }

    // ── 3. Import inspections + violations ───────────────────────────────────
    // Delete existing inspections for this client — cascades to violations
    await supabase.from("inspections").delete().eq("client_id", clientId);

    const inspections = await getInspections(dotNumber);
    let violationCount = 0;

    for (const insp of inspections) {
      const { data: inspRow, error: inspErr } = await supabase
        .from("inspections")
        .insert({
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
        })
        .select("id")
        .single();

      if (inspErr || !inspRow) {
        console.error("Inspection insert failed:", inspErr?.message);
        continue;
      }

      for (const viol of insp.violations) {
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
        }
      }
    }

    // ── 4. Import crashes ────────────────────────────────────────────────────
    // Delete existing crashes — cascades to cpdp_cases
    await supabase.from("crashes").delete().eq("client_id", clientId);

    const crashes = await getCrashes(dotNumber);

    for (const crash of crashes) {
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

    // ── 5. Activate client if still in prospect status ───────────────────────
    await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId)
      .eq("status", "prospect");

    // ── 6. Log activity ──────────────────────────────────────────────────────
    await supabase.from("activity_log").insert({
      client_id: clientId,
      action_type: "data_imported",
      entity_type: "client",
      description: `Full analysis run: ${inspections.length} inspections, ${violationCount} violations, ${crashes.length} crashes imported. BASIC scores updated.`,
    });

    return NextResponse.json({
      success: true,
      inspections: inspections.length,
      violations: violationCount,
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
