import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
import { runClientRefresh } from "@/lib/monitoring/run-client-refresh";
import {
  emitRefreshAlerts,
  sendViolationEmailsForIds,
} from "@/lib/monitoring/alerts";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runChallengeabilityAssessment, type ChallengeabilityRunResult } from "@/lib/analysis/challengeability-assessment-server";
import {
  runMcs150TruthUp,
  type Mcs150TruthUpRunResult,
} from "@/lib/mcs150/truth-up-server";
import { tierHasFeature } from "@/lib/tiers";

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
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = await createServiceClient();
  const { data: userRecord, error: roleError } = await serviceClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (roleError) {
    return NextResponse.json(
      { error: `Unable to verify staff role: ${roleError.message}` },
      { status: 500 }
    );
  }
  if (userRecord?.role !== "geia_admin" && userRecord?.role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  return runAnalysisImport(parsed.data, user.id);
}

export async function runAnalysisImport({
  clientId,
  dotNumber,
}: z.infer<typeof schema>, actorUserId?: string) {
  const supabase = getAdmin();

  try {
    const refresh = await runClientRefresh({ clientId, dotNumber }, supabase);
    const saferSnap = refresh.saferSnapshot;
    let mcs150TruthUp: Mcs150TruthUpRunResult | null = null;
    let mcs150TruthUpError: string | null = null;
    try {
      const { data: truthUpClient, error: truthUpClientError } = await supabase
        .from("clients")
        .select("name, tier")
        .eq("id", clientId)
        .single();
      if (truthUpClientError || !truthUpClient) {
        throw new Error(
          `Unable to load the client tier for MCS-150 truth-up: ${
            truthUpClientError?.message ?? "Client not found"
          }`
        );
      }
      mcs150TruthUp = tierHasFeature(
        truthUpClient.tier,
        "compliance_layer"
      )
        ? await runMcs150TruthUp(
            {
              clientId,
              clientName: truthUpClient.name,
              dotNumber,
              complianceIncluded: true,
              freshCensus: saferSnap,
              burdenPoints: refresh.burden.totalPoints,
            },
            supabase
          )
        : null;
    } catch (truthUpError) {
      mcs150TruthUpError =
        truthUpError instanceof Error
          ? truthUpError.message
          : "MCS-150 truth-up check failed";
    }
    const basics = refresh.basics;
    const inspections = { length: refresh.inspectionsPulled };
    const violationCount = refresh.violationsProcessed;
    const newViolationCount = refresh.newViolationIds.length;
    const crashes = { length: refresh.crashesPulled };

    const emittedAlerts = refresh.hadMonitoringBaseline
      ? await emitRefreshAlerts(supabase, {
          clientId,
          newViolationIds: refresh.newViolationIds,
          newInspectionIds: refresh.newInspectionIds,
          newCrashIds: refresh.newCrashIds,
          oosRateChange: refresh.oosRateChange,
        })
      : { created: [] };

    if (refresh.hadExistingViolations) {
      await sendViolationEmailsForIds(supabase, {
        clientId,
        violationIds: refresh.newViolationIds,
        companyName: saferSnap?.legalName ?? `DOT ${dotNumber}`,
        dotNumber,
      });
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
    const { data: activatedClient, error: activationError } = await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId)
      .in("status", ["onboarding", "prospect", "awaiting_activation"])
      .select("id")
      .maybeSingle();
    if (activationError) {
      throw new Error(`Client activation after analysis failed: ${activationError.message}`);
    }
    if (activatedClient) {
      const { error: activationLogError } = await supabase
        .from("activity_log")
        .insert({
          client_id: clientId,
          user_id: actorUserId ?? null,
          action_type: "client_activated_by_analysis",
          entity_type: "clients",
          entity_id: clientId,
          description: "GEIA analysis activated the client portal",
          metadata: { to_status: "active", source: "analysis_import" },
        });
      if (activationLogError) {
        throw new Error(
          `Client was activated, but activation logging failed: ${activationLogError.message}`
        );
      }
    }

    const monitoringSnapshot = await captureBurdenSnapshot(clientId, "rerun", supabase);

    // Challengeability is a required analysis stage, not cosmetic progress text.
    // Assess only rows that remain unstamped so refreshes preserve completed work.
    let challengeability: ChallengeabilityRunResult | null = null;
    let challengeabilityError: string | null = null;
    try {
      challengeability = await runChallengeabilityAssessment(supabase, clientId);
      if (challengeability.failures.length > 0) {
        challengeabilityError =
          `${challengeability.failures.length} violation(s) remain unassessed after OpenRouter errors.`;
      } else if (challengeability.hasMore) {
        challengeabilityError =
          "Challengeability analysis saved its first bounded batch; run the standalone action to complete the remaining violations.";
      }
    } catch (error) {
      challengeabilityError = error instanceof Error ? error.message : "Challengeability analysis failed";
    }

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
        `${refresh.newInspectionIds.length} new inspections, ${violationCount} violations (${newViolationCount} new), ` +
        `${crashes.length} crashes ingested, ${emittedAlerts.created.length} monitoring alerts created. ` +
        `BASIC measures + percentiles updated; ${alertSummary}. ` +
        `OOS rates (SAFER): veh ${saferSnap?.vehicleOosRate ?? "n/a"}%, drv ${saferSnap?.driverOosRate ?? "n/a"}%, hm ${saferSnap?.hazmatOosRate ?? "n/a"}%.`,
      metadata: {
        source: "operator_analysis_import",
      },
    });

    const responseBody = {
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
      newInspections: refresh.newInspectionIds.length,
      violations: violationCount,
      newViolations: newViolationCount,
      crashes: crashes.length,
      oosChanges: refresh.oosRateChange?.changes ?? [],
      alertsCreated: emittedAlerts.created.length,
      oos: {
        vehicle: saferSnap?.vehicleOosRate ?? null,
        driver: saferSnap?.driverOosRate ?? null,
        hazmat: saferSnap?.hazmatOosRate ?? null,
      },
      monitoringSnapshot,
      mcs150TruthUp,
      challengeability,
    };

    const incompleteStages = [
      challengeabilityError
        ? `challengeability analysis did not complete: ${challengeabilityError}`
          : null,
      mcs150TruthUpError
        ? `MCS-150 truth-up check failed: ${mcs150TruthUpError}`
        : null,
      mcs150TruthUp?.quarterly.status === "failed"
        ? `MCS-150 truth-up check failed: ${mcs150TruthUp.quarterly.reason}`
        : null,
    ].filter((message): message is string => Boolean(message));
    if (incompleteStages.length > 0) {
      return NextResponse.json({
        ...responseBody,
        success: false,
        importCompleted: true,
        error: `FMCSA import completed, but ${incompleteStages.join(" | ")}`,
      }, { status: 502 });
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    console.error("Analysis import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
