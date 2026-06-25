import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getBasics,
  getOosRates,
  getInspections,
  getCrashes,
} from "@/lib/fmcsa/client";
import { getSAFERSnapshot } from "@/lib/fmcsa/safer";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
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
    // ── 1. Fetch carrier census (SAFER) + BASIC scores + national OOS averages ─
    // getSAFERSnapshot is the authoritative source for all headline carrier
    // summary fields: power units, drivers, MCS-150, authority, OOS rates,
    // crash totals. No API key required — public FMCSA page.
    // getOosRates is retained solely for the national average values embedded
    // in its response; carrier-specific rates now come from SAFER.
    const [saferSnap, basics, oos] = await Promise.all([
      getSAFERSnapshot(dotNumber).catch((err) => {
        console.error(
          "[import] SAFER snapshot failed:",
          err instanceof Error ? err.message : err
        );
        return null;
      }),
      getBasics(dotNumber),
      getOosRates(dotNumber).catch(() => null),
    ]);

    // ── 1a. Reconcile carrier census into carrier_profiles (SAFER authoritative) ─
    // SAFER snapshot replaces QCMobile/DataHub for all headline carrier summary
    // fields. MC# is not exposed in the SAFER snapshot — kept as null here and
    // left to any existing QCMobile-sourced value if already present in the DB.
    //
    // Uses explicit SELECT → UPDATE/INSERT instead of .upsert() to avoid
    // silent failures observed with PostgREST onConflict on this table.
    if (saferSnap) {
      const censusPayload = {
        dot_number: dotNumber,
        mc_number: null as string | null, // SAFER snapshot does not expose MC#
        legal_name: saferSnap.legalName,
        dba_name: saferSnap.dbaName,
        power_units: saferSnap.powerUnits,
        drivers: saferSnap.drivers,
        mcs150_date: saferSnap.mcs150Date,
        mcs150_mileage: saferSnap.mcs150Mileage,
        mcs150_mileage_year: saferSnap.mcs150MileageYear,
        cargo_types: saferSnap.cargoTypes.length > 0 ? saferSnap.cargoTypes : null,
        authority_status: saferSnap.operatingAuthority,
        safety_rating: saferSnap.safetyRating,
        safety_rating_date: saferSnap.safetyRatingDate,
        review_type: saferSnap.reviewType,
        review_date: saferSnap.reviewDate,
        entity_type: saferSnap.entityType,
        carrier_operation: saferSnap.operatingStatus,
        safer_as_of: saferSnap.saferAsOf,
        national_vehicle_oos_rate: saferSnap.nationalVehicleOosRate,
        national_driver_oos_rate: saferSnap.nationalDriverOosRate,
        national_hazmat_oos_rate: saferSnap.nationalHazmatOosRate,
        fetched_at: new Date().toISOString(),
      };

      console.log("[import] SAFER census payload:", {
        power_units: censusPayload.power_units,
        drivers: censusPayload.drivers,
        mcs150_date: censusPayload.mcs150_date,
        mcs150_mileage: censusPayload.mcs150_mileage,
        authority_status: censusPayload.authority_status,
        safety_rating_date: censusPayload.safety_rating_date,
        review_date: censusPayload.review_date,
        cargo_types: censusPayload.cargo_types,
      });

      // Check if a profile already exists for this client
      const { data: existingProfile, error: selectErr } = await supabase
        .from("carrier_profiles")
        .select("id")
        .eq("client_id", clientId)
        .maybeSingle();

      if (selectErr) {
        console.error("[import] carrier_profiles SELECT error:", selectErr.code, selectErr.message);
      }

      if (existingProfile) {
        // Preserve existing mc_number if we can't source it from SAFER
        const { data: existingMc } = await supabase
          .from("carrier_profiles")
          .select("mc_number")
          .eq("client_id", clientId)
          .maybeSingle();
        if (existingMc?.mc_number) {
          censusPayload.mc_number = existingMc.mc_number;
        }

        const { error: profileErr } = await supabase
          .from("carrier_profiles")
          .update(censusPayload)
          .eq("client_id", clientId);

        if (profileErr) {
          console.error(
            "[import] carrier_profiles UPDATE error:",
            profileErr.code,
            profileErr.message,
            profileErr.details,
            profileErr.hint
          );
        } else {
          console.log(
            `[import] carrier_profiles updated for client ${clientId} (SAFER): ` +
            `power_units=${saferSnap.powerUnits}, drivers=${saferSnap.drivers}, ` +
            `authority=${saferSnap.operatingAuthority ?? "null"}`
          );
        }
      } else {
        const { error: profileErr } = await supabase
          .from("carrier_profiles")
          .insert({ client_id: clientId, ...censusPayload });

        if (profileErr) {
          console.error(
            "[import] carrier_profiles INSERT error:",
            profileErr.code,
            profileErr.message,
            profileErr.details,
            profileErr.hint
          );
        } else {
          console.log(
            `[import] carrier_profiles inserted for client ${clientId} (SAFER): ` +
            `power_units=${saferSnap.powerUnits}, drivers=${saferSnap.drivers}`
          );
        }
      }
    }

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
          unsafe_driving_alert: basics.unsafeDriving?.alert ?? false,
          hos_compliance_measure: basics.hosCompliance?.measureValue ?? null,
          hos_compliance_pct: basics.hosCompliance?.percentile ?? null,
          hos_compliance_alert: basics.hosCompliance?.alert ?? false,
          driver_fitness_measure: basics.driverFitness?.measureValue ?? null,
          driver_fitness_pct: basics.driverFitness?.percentile ?? null,
          driver_fitness_alert: basics.driverFitness?.alert ?? false,
          controlled_substance_measure:
            basics.controlledSubstances?.measureValue ?? null,
          controlled_substance_pct:
            basics.controlledSubstances?.percentile ?? null,
          controlled_substance_alert:
            basics.controlledSubstances?.alert ?? false,
          vehicle_maint_measure:
            basics.vehicleMaintenance?.measureValue ?? null,
          vehicle_maint_pct: basics.vehicleMaintenance?.percentile ?? null,
          vehicle_maint_alert: basics.vehicleMaintenance?.alert ?? false,
          hm_compliance_measure: basics.hmCompliance?.measureValue ?? null,
          hm_compliance_pct: basics.hmCompliance?.percentile ?? null,
          hm_compliance_alert: basics.hmCompliance?.alert ?? false,
          crash_indicator_measure:
            basics.crashIndicator?.measureValue ?? null,
          crash_indicator_pct: basics.crashIndicator?.percentile ?? null,
          crash_indicator_alert: basics.crashIndicator?.alert ?? false,
          // OOS rates from SAFER (authoritative) — fall back to DataHub-derived values
          oos_vehicle_rate: saferSnap?.vehicleOosRate ?? oos?.vehicleOosRate ?? null,
          oos_driver_rate: saferSnap?.driverOosRate ?? oos?.driverOosRate ?? null,
          oos_hazmat_rate: saferSnap?.hazmatOosRate ?? oos?.hazmatOosRate ?? null,
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

      // Backfill canonical_inspection_date on any dataq_cases linked to
      // violations in this inspection that have not yet been assigned a
      // canonical date. Uses the authoritative date from the FMCSA inspection
      // record rather than whatever value may have been inferred elsewhere.
      {
        const { data: linkedViolIds } = await supabase
          .from("violations")
          .select("id")
          .eq("inspection_id", inspRow.id);

        if (linkedViolIds && linkedViolIds.length > 0) {
          const violIds = linkedViolIds.map((v: { id: string }) => v.id);
          const { error: canonErr } = await supabase
            .from("dataq_cases")
            .update({ canonical_inspection_date: insp.inspectionDate })
            .in("violation_id", violIds)
            .is("canonical_inspection_date", null);

          if (canonErr) {
            console.error(
              "canonical_inspection_date backfill failed:",
              canonErr.message
            );
          }
        }
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

    // ── 6. Generate evidence items for DataQ cases that have none ────────────
    function buildEvidenceItems(
      basicCategory: string | null,
      canonDate: string,
      inspState: string,
      violationCode?: string | null
    ): Array<{
      doc_type: string;
      label: string;
      context_note: string;
      fmcsa_category: string;
      required: boolean;
    }> {
      const cat = (basicCategory ?? "").toLowerCase();

      if (cat === "vehicle_maintenance") {
        return [
          {
            doc_type: "eld_record",
            label: "ELD/driver log records",
            fmcsa_category: "Electronic Logging Device (ELD) Records",
            context_note: `Records for ${canonDate} (${inspState})`,
            required: true,
          },
          {
            doc_type: "vehicle_inspection",
            label: "Vehicle maintenance/repair records",
            fmcsa_category: "Vehicle Inspection Records",
            context_note: "Maintenance records relevant to the inspection date",
            required: false,
          },
        ];
      }

      if (cat === "hos_compliance") {
        const is395_8 = violationCode?.startsWith("395.8") ?? false;
        if (is395_8) {
          return [
            {
              doc_type: "driver_log",
              label: "Record of Duty Status (RODS) — paper logs",
              fmcsa_category: "Driver Logs",
              context_note: `Paper daily log / RODS for ${canonDate} (${inspState})`,
              required: true,
            },
            {
              doc_type: "bol",
              label: "Supporting documentation (bills of lading, fuel receipts)",
              fmcsa_category: "Bill of Lading/Shipping Papers",
              context_note: `Supporting records for the duty period on ${canonDate}`,
              required: false,
            },
          ];
        } else {
          return [
            {
              doc_type: "eld_record",
              label: "ELD records and driver hours logs",
              fmcsa_category: "Electronic Logging Device (ELD) Records",
              context_note: `Hours of service records for ${canonDate} (${inspState})`,
              required: true,
            },
            {
              doc_type: "driver_log",
              label: "Driver recap/70-hour records",
              fmcsa_category: "Driver Logs",
              context_note: `70-hour period including ${canonDate}`,
              required: false,
            },
          ];
        }
      }

      if (cat === "driver_fitness") {
        return [
          {
            doc_type: "driver_log",
            label: "Driver qualification file",
            fmcsa_category: "Driver Qualification File",
            context_note: `Driver file current as of ${canonDate}`,
            required: true,
          },
          {
            doc_type: "driver_log",
            label: "Medical examiner certificate",
            fmcsa_category: "Medical Certificate",
            context_note: `Valid certificate at time of ${canonDate} (${inspState})`,
            required: false,
          },
        ];
      }

      if (cat === "unsafe_driving") {
        return [
          {
            doc_type: "eld_record",
            label: "ELD location and speed data",
            fmcsa_category: "Electronic Logging Device (ELD) Records",
            context_note: `GPS/speed records for ${canonDate} (${inspState})`,
            required: true,
          },
        ];
      }

      if (cat === "controlled_substance") {
        return [
          {
            doc_type: "driver_log",
            label: "Drug and alcohol test records",
            fmcsa_category: "Drug and Alcohol Testing Records",
            context_note: `Testing records relevant to ${canonDate}`,
            required: true,
          },
        ];
      }

      if (cat === "hazmat_compliance") {
        return [
          {
            doc_type: "bol",
            label: "Hazmat shipping papers and placards",
            fmcsa_category: "Bill of Lading/Shipping Papers",
            context_note: `Hazmat shipment documentation for ${canonDate} (${inspState})`,
            required: true,
          },
        ];
      }

      // Default — null or unrecognized category
      return [
        {
          doc_type: "other",
          label: "Inspection report and supporting documentation",
          fmcsa_category: "Other",
          context_note: `Supporting documentation for ${canonDate} inspection in ${inspState}`,
          required: true,
        },
      ];
    }

    const { data: casesNeedingEvidence } = await supabase
      .from("dataq_cases")
      .select("id")
      .eq("client_id", clientId);

    for (const dc of casesNeedingEvidence ?? []) {
      const { count } = await supabase
        .from("dataq_evidence")
        .select("id", { count: "exact", head: true })
        .eq("case_id", dc.id);

      if ((count ?? 0) === 0) {
        const { data: caseData } = await supabase
          .from("dataq_cases")
          .select(
            "*, violations(basic_category, violation_code), inspections(inspection_date, state)"
          )
          .eq("id", dc.id)
          .single();

        if (caseData) {
          const viol = Array.isArray(caseData.violations)
            ? caseData.violations[0]
            : caseData.violations;
          const insp = Array.isArray(caseData.inspections)
            ? caseData.inspections[0]
            : caseData.inspections;
          const canonDate =
            (caseData.canonical_inspection_date as string | null) ??
            (insp as { inspection_date: string } | null)?.inspection_date ??
            "the inspection date";
          const inspState =
            (insp as { state: string } | null)?.state ?? "unknown";
          const basicCat =
            (viol as { basic_category: string | null } | null)
              ?.basic_category ?? null;
          const violCode =
            (viol as Record<string, unknown>)?.violation_code as string | null ?? undefined;

          const evidenceItems = buildEvidenceItems(basicCat, canonDate, inspState, violCode);

          if (evidenceItems.length > 0) {
            const { error: evidErr } = await supabase
              .from("dataq_evidence")
              .insert(evidenceItems.map((item) => ({ ...item, case_id: dc.id })));

            if (evidErr) {
              console.error(
                `Evidence generation failed for case ${dc.id}:`,
                evidErr.message
              );
            } else {
              console.log(
                `Generated ${evidenceItems.length} evidence item(s) for DataQ case ${dc.id}`
              );
            }
          }
        }
      }
    }

    // ── 7. Activate client if still in onboarding or prospect status ─────────
    await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId)
      .in("status", ["onboarding", "prospect"]);

    const monitoringSnapshot = await captureBurdenSnapshot(clientId, "rerun");

    // ── 8. Log activity ──────────────────────────────────────────────────────
    const censusSummary = saferSnap
      ? `census refreshed via SAFER (${saferSnap.powerUnits} power units / ${saferSnap.drivers} drivers, authority: ${saferSnap.operatingAuthority ?? "n/a"})`
      : "census not refreshed (SAFER snapshot unavailable)";

    const alertedBasics = [
      basics.unsafeDriving?.alert && "Unsafe Driving",
      basics.hosCompliance?.alert && "HOS",
      basics.driverFitness?.alert && "Driver Fitness",
      basics.controlledSubstances?.alert && "Controlled Substances",
      basics.vehicleMaintenance?.alert && "Vehicle Maintenance",
      basics.hmCompliance?.alert && "HM",
      basics.crashIndicator?.alert && "Crash Indicator",
    ].filter(Boolean) as string[];

    const alertSummary = alertedBasics.length
      ? `BASIC alerts: ${alertedBasics.join(", ")}`
      : "no BASIC alerts";

    await supabase.from("activity_log").insert({
      client_id: clientId,
      action_type: "data_imported",
      entity_type: "client",
      description:
        `Full analysis run: ${censusSummary}; ${inspections.length} inspections, ` +
        `${violationCount} violations (${newViolationCount} new), ` +
        `${crashes.length} crashes ingested. BASIC measures + percentiles updated; ${alertSummary}. ` +
        `OOS rates (SAFER): veh ${saferSnap?.vehicleOosRate ?? "n/a"}%, drv ${saferSnap?.driverOosRate ?? "n/a"}%, hm ${saferSnap?.hazmatOosRate ?? "n/a"}%.`,
    });

    return NextResponse.json({
      success: true,
      census: saferSnap
        ? {
            powerUnits: saferSnap.powerUnits,
            drivers: saferSnap.drivers,
            mcs150Date: saferSnap.mcs150Date,
            vehicleOosRate: saferSnap.vehicleOosRate,
            hazmatOosRate: saferSnap.hazmatOosRate,
            authorityStatus: saferSnap.operatingAuthority,
          }
        : null,
      inspections: inspections.length,
      violations: violationCount,
      newViolations: newViolationCount,
      crashes: crashes.length,
      oos: {
        vehicle: saferSnap?.vehicleOosRate ?? null,
        driver: saferSnap?.driverOosRate ?? null,
        hazmat: saferSnap?.hazmatOosRate ?? null,
      },
      monitoringSnapshot,
    });
  } catch (err) {
    console.error("Analysis import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
