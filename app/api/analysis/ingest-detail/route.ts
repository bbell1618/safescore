import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseInspectionDetailXml } from "@/lib/fmcsa/inspection-detail-xml";
import type { InspectionDetailInspection } from "@/lib/fmcsa/inspection-detail-xml-types";
import { loadViolationReferenceLookup } from "@/lib/fmcsa/violation-reference";
import { captureBurdenSnapshot } from "@/lib/monitoring/snapshot";
import { parseAllBasicsExport } from "@/lib/fmcsa/all-basics-export";
import {
  buildSourceUpdate,
  planDetailViolationWrites,
  type DetailViolationCandidate,
} from "@/lib/fmcsa/ingest-write-policy";
import {
  reassessViolationOnChange,
  type ViolationEnrichmentRow,
} from "@/lib/challengeability/reassess-on-change";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().uuid(),
  dotNumber: z.string().min(1),
});

type InspectionRow = {
  id: string;
  mcmis_inspection_id: string | null;
  report_number: string;
};

type InspectionVehicleIdentity = {
  id: string;
  inspection_id: string;
  unit_number: number | null;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
};

type ServiceSupabaseClient = Awaited<ReturnType<typeof createServiceClient>>;

export async function POST(request: NextRequest) {
  const authError = await requireStaff();
  if (authError) return authError;

  const parsedInput = await readInput(request);
  if (!parsedInput.ok) {
    return NextResponse.json({ error: parsedInput.error }, { status: parsedInput.status });
  }

  const parsed = schema.safeParse({
    clientId: parsedInput.clientId,
    dotNumber: parsedInput.dotNumber,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clientId, dotNumber } = parsed.data;
  const serviceSupabase = await createServiceClient();

  const { data: client, error: clientError } = await serviceSupabase
    .from("clients")
    .select("id, dot_number")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (String(client.dot_number) !== dotNumber) {
    return NextResponse.json({ error: "DOT number does not match client" }, { status: 400 });
  }

  const fileHash = createHash("sha256").update(parsedInput.content).digest("hex");
  const { data: priorIngest, error: priorError } = await serviceSupabase
    .from("fmcsa_ingest_files")
    .select("ingest_kind, parsed_summary")
    .eq("client_id", clientId)
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }
  if (priorIngest) {
    return NextResponse.json({
      ...(priorIngest.parsed_summary as Record<string, unknown>),
      status: "skipped",
      ingest_kind: priorIngest.ingest_kind,
      dedupe_key: `${clientId}:${fileHash}`,
      inserted: 0,
      skipped: 1,
    });
  }

  const ingestKind = detectIngestKind(parsedInput.filename, parsedInput.content);
  if (ingestKind === "all_basics") {
    try {
      const allBasics = parseAllBasicsExport(parsedInput.content);
      const b = allBasics.basics;
      const { error: snapshotError } = await serviceSupabase
        .from("score_snapshots")
        .upsert(
          {
            client_id: clientId,
            snapshot_date: allBasics.snapshotDate,
            unsafe_driving_measure: b.unsafe_driving.measure,
            unsafe_driving_pct: b.unsafe_driving.percentile,
            unsafe_driving_alert: b.unsafe_driving.alert,
            hos_compliance_measure: b.hos_compliance.measure,
            hos_compliance_pct: b.hos_compliance.percentile,
            hos_compliance_alert: b.hos_compliance.alert,
            driver_fitness_measure: b.driver_fitness.measure,
            driver_fitness_pct: b.driver_fitness.percentile,
            driver_fitness_alert: b.driver_fitness.alert,
            controlled_substance_measure: b.controlled_substance.measure,
            controlled_substance_pct: b.controlled_substance.percentile,
            controlled_substance_alert: b.controlled_substance.alert,
            vehicle_maint_measure: b.vehicle_maintenance.measure,
            vehicle_maint_pct: b.vehicle_maintenance.percentile,
            vehicle_maint_alert: b.vehicle_maintenance.alert,
            hm_compliance_measure: b.hazmat_compliance.measure,
            hm_compliance_pct: b.hazmat_compliance.percentile,
            hm_compliance_alert: b.hazmat_compliance.alert,
            crash_indicator_measure: b.crash_indicator.measure,
            crash_indicator_pct: b.crash_indicator.percentile,
            crash_indicator_alert: b.crash_indicator.alert,
            official_basics: b,
            source_file_hash: fileHash,
            source: "authenticated",
          },
          { onConflict: "client_id,snapshot_date" }
        );
      if (snapshotError) {
        return NextResponse.json({ error: snapshotError.message }, { status: 500 });
      }

      const summary = {
        parsed: 7,
        inserted: 1,
        skipped: 0,
        flagged: Object.values(b).filter((basic) => basic.alert).length,
        snapshot_date: allBasics.snapshotDate,
      };
      const registryError = await registerIngest(
        serviceSupabase,
        clientId,
        fileHash,
        ingestKind,
        parsedInput.filename,
        summary
      );
      if (registryError) return registryError;

      return NextResponse.json({
        status: "inserted",
        ingest_kind: ingestKind,
        dedupe_key: `${clientId}:${fileHash}`,
        ...summary,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to parse All BASICs export" },
        { status: 400 }
      );
    }
  }

  const lookup = await loadViolationReferenceLookup(serviceSupabase);
  let inspections: InspectionDetailInspection[];
  try {
    inspections = parseInspectionDetailXml(parsedInput.content, lookup);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse COMPASS XML" },
      { status: 400 }
    );
  }
  if (inspections.length === 0) {
    return NextResponse.json({ error: "COMPASS XML contains no inspections" }, { status: 400 });
  }
  const { data: existingRows, error: existingError } = await serviceSupabase
    .from("inspections")
    .select("id, mcmis_inspection_id, report_number")
    .eq("client_id", clientId);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingByMcmis = new Map<string, InspectionRow>();
  for (const row of (existingRows ?? []) as InspectionRow[]) {
    if (!row.mcmis_inspection_id) continue;
    const prior = existingByMcmis.get(row.mcmis_inspection_id);
    if (prior && prior.id !== row.id) {
      return NextResponse.json(
        { error: `Ambiguous existing MCMIS inspection ID: ${row.mcmis_inspection_id}` },
        { status: 409 }
      );
    }
    existingByMcmis.set(row.mcmis_inspection_id, row);
  }
  const existingByReport = new Map(
    ((existingRows ?? []) as InspectionRow[]).map((row) => [row.report_number, row])
  );

  const incomingMcmisIds = new Set<string>();
  const incomingReportNumbers = new Set<string>();
  for (const inspection of inspections) {
    if (incomingMcmisIds.has(inspection.mcmisInspectionId)) {
      return NextResponse.json(
        { error: `Duplicate incoming MCMIS inspection ID: ${inspection.mcmisInspectionId}` },
        { status: 409 }
      );
    }
    if (incomingReportNumbers.has(inspection.reportNumber)) {
      return NextResponse.json(
        { error: `Duplicate incoming report number: ${inspection.reportNumber}` },
        { status: 409 }
      );
    }
    incomingMcmisIds.add(inspection.mcmisInspectionId);
    incomingReportNumbers.add(inspection.reportNumber);
  }

  const upserted: Array<{ inspection: InspectionDetailInspection; row: InspectionRow }> = [];
  const matchedExistingIds = new Set<string>();
  let insertedInspectionCount = 0;

  for (const inspection of inspections) {
    const payload = inspectionPayload(clientId, dotNumber, inspection);
    const byMcmis = existingByMcmis.get(inspection.mcmisInspectionId);
    const byReport = existingByReport.get(inspection.reportNumber);
    if (byMcmis && byReport && byMcmis.id !== byReport.id) {
      return NextResponse.json(
        {
          error:
            `Ambiguous inspection match for MCMIS ${inspection.mcmisInspectionId} ` +
            `and report ${inspection.reportNumber}`,
        },
        { status: 409 }
      );
    }
    const existing = byMcmis ?? byReport;

    if (existing) {
      const { data: updated, error } = await serviceSupabase
        .from("inspections")
        .update(buildSourceUpdate(payload))
        .eq("id", existing.id)
        .select("id, mcmis_inspection_id, report_number")
        .single();
      if (error || !updated) {
        return NextResponse.json(
          { error: error?.message ?? "Failed to update inspection" },
          { status: 500 }
        );
      }
      upserted.push({ inspection, row: updated });
      matchedExistingIds.add(existing.id);
    } else {
      const { data: inserted, error } = await serviceSupabase
        .from("inspections")
        .insert(payload)
        .select("id, mcmis_inspection_id, report_number")
        .single();
      if (error || !inserted) {
        return NextResponse.json(
          { error: error?.message ?? "Failed to insert inspection" },
          { status: 500 }
        );
      }
      upserted.push({ inspection, row: inserted });
      insertedInspectionCount += 1;
    }
  }

  const upsertedIds = upserted.map(({ row }) => row.id);

  if (upsertedIds.length > 0) {
    const { data: existingViolationRows, error: violationReadError } = await serviceSupabase
      .from("violations")
      .select("id, client_id, inspection_id, violation_code, citation_number, citation_result, convicted")
      .eq("client_id", clientId)
      .in("inspection_id", upsertedIds);
    if (violationReadError) {
      return NextResponse.json({ error: violationReadError.message }, { status: 500 });
    }

    const violationRows: DetailViolationCandidate[] = upserted.flatMap(({ inspection, row }) =>
      inspection.violations.map((violation) => ({
        inspection_id: row.id,
        client_id: clientId,
        violation_code: violation.violationCode,
        violation_description: violation.violationDescription,
        basic_category: violation.basicCategory,
        severity_weight: violation.severityWeight,
        time_weight: violation.timeWeight,
        oos_violation: violation.oosViolation,
        citation_number: violation.citationNumber,
        citation_result: violation.citationResult,
      }))
    );

    let violationPlan: ReturnType<typeof planDetailViolationWrites>;
    try {
      violationPlan = planDetailViolationWrites(existingViolationRows ?? [], violationRows);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Ambiguous violation merge" },
        { status: 409 }
      );
    }

    const existingViolationById = new Map(
      (existingViolationRows ?? []).map((row) => [row.id, row])
    );

    for (const update of violationPlan.updates) {
      const before = existingViolationById.get(update.id);
      if (!before) {
        return NextResponse.json(
          { error: `Unable to load existing violation ${update.id} before enrichment update` },
          { status: 500 }
        );
      }

      const { data: after, error } = await serviceSupabase
        .from("violations")
        .update(update.payload)
        .eq("client_id", clientId)
        .eq("id", update.id)
        .select("id, client_id, citation_number, citation_result, convicted")
        .single();
      if (error || !after) {
        return NextResponse.json(
          { error: error?.message ?? `Failed to update violation ${update.id}` },
          { status: 500 }
        );
      }

      try {
        await reassessViolationOnChange(serviceSupabase, {
          clientId,
          violationId: update.id,
          before: before as ViolationEnrichmentRow,
          after: after as ViolationEnrichmentRow,
        });
      } catch (reassessmentError) {
        const message = reassessmentError instanceof Error
          ? reassessmentError.message
          : "Unknown challengeability reassessment failure";
        return NextResponse.json(
          {
            error: `Violation ${update.id} was enriched, but challengeability reassessment failed: ${message}`,
          },
          { status: 502 }
        );
      }
    }

    if (violationPlan.inserts.length > 0) {
      const { error: violationInsertError } = await serviceSupabase
        .from("violations")
        .insert(violationPlan.inserts);
      if (violationInsertError) {
        return NextResponse.json({ error: violationInsertError.message }, { status: 500 });
      }
    }

    const { data: existingVehicleRows, error: vehicleReadError } = await serviceSupabase
      .from("inspection_vehicles")
      .select("id, inspection_id, unit_number, vin, license_plate, license_state")
      .in("inspection_id", upsertedIds);
    if (vehicleReadError) {
      return NextResponse.json({ error: vehicleReadError.message }, { status: 500 });
    }

    const vehicleRows = upserted.flatMap(({ inspection, row }) =>
      inspection.vehicles.map((vehicle) => ({
        inspection_id: row.id,
        client_id: clientId,
        unit_number: vehicle.unitNumber,
        unit_type: vehicle.unitType,
        make: vehicle.make,
        vin: vehicle.vin,
        license_plate: vehicle.licensePlate,
        license_state: vehicle.licenseState,
        iep_dot: vehicle.iepDot,
      }))
    );

    let vehiclePlan: ReturnType<typeof planVehicleWrites>;
    try {
      vehiclePlan = planVehicleWrites(existingVehicleRows ?? [], vehicleRows);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Ambiguous vehicle merge" },
        { status: 409 }
      );
    }

    for (const update of vehiclePlan.updates) {
      const { error } = await serviceSupabase
        .from("inspection_vehicles")
        .update(update.payload)
        .eq("id", update.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (vehiclePlan.inserts.length > 0) {
      const { error: vehicleInsertError } = await serviceSupabase
        .from("inspection_vehicles")
        .insert(vehiclePlan.inserts);
      if (vehicleInsertError) {
        return NextResponse.json({ error: vehicleInsertError.message }, { status: 500 });
      }
    }

    for (const { row } of upserted) {
      const { data: persistedViolations, error: countError } = await serviceSupabase
        .from("violations")
        .select("oos_violation")
        .eq("inspection_id", row.id);
      if (countError) {
        return NextResponse.json({ error: countError.message }, { status: 500 });
      }
      const totalViolations = persistedViolations?.length ?? 0;
      const oosViolations = (persistedViolations ?? []).filter(
        (violation) => violation.oos_violation
      ).length;
      const { error } = await serviceSupabase
        .from("inspections")
        .update({
          total_violations: totalViolations,
          oos_violations: oosViolations,
        })
        .eq("id", row.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  const violationCount = inspections.reduce(
    (sum, inspection) => sum + inspection.violations.length,
    0
  );
  const oosCount = inspections.reduce(
    (sum, inspection) =>
      sum + inspection.violations.filter((violation) => violation.oosViolation).length,
    0
  );
  const citationCount = inspections.reduce(
    (sum, inspection) =>
      sum + inspection.violations.filter((violation) => violation.citationNumber).length,
    0
  );
  const vehicleCount = inspections.reduce(
    (sum, inspection) => sum + inspection.vehicles.length,
    0
  );

  try {
    await captureBurdenSnapshot(clientId, "ingest");
  } catch (error) {
    console.error("Failed to capture burden snapshot after detail ingest", error);
  }

  const summary = {
    inspections: inspections.length,
    violations: violationCount,
    oos: oosCount,
    citations: citationCount,
    vehicles: vehicleCount,
    unmatched_codes: unmatchedCodes(inspections),
    untouched_inspections: (existingRows?.length ?? 0) - matchedExistingIds.size,
    parsed: inspections.length,
    inserted: insertedInspectionCount,
    skipped: 0,
    flagged: oosCount + unmatchedCodes(inspections).length,
  };
  const registryError = await registerIngest(
    serviceSupabase,
    clientId,
    fileHash,
    ingestKind,
    parsedInput.filename,
    summary
  );
  if (registryError) return registryError;

  return NextResponse.json({
    status: "inserted",
    ingest_kind: ingestKind,
    dedupe_key: `${clientId}:${fileHash}`,
    ...summary,
  });
}

async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = await createServiceClient();
  const { data: userRecord } = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const role: string = userRecord?.role ?? "client_user";
  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

async function readInput(request: NextRequest): Promise<
  | { ok: true; clientId: string | null; dotNumber: string | null; content: string; filename: string | null }
  | { ok: false; error: string; status: number }
> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const contentField = form.get("xml") ?? form.get("content");
    const content =
      file instanceof File
        ? await file.text()
        : typeof contentField === "string"
          ? contentField
          : "";
    return {
      ok: true,
      clientId: stringOrNull(form.get("clientId")),
      dotNumber: stringOrNull(form.get("dotNumber")),
      content,
      filename: file instanceof File ? file.name : stringOrNull(form.get("filename")),
    };
  }

  const content = await request.text();
  return {
    ok: true,
    clientId: request.nextUrl.searchParams.get("clientId"),
    dotNumber: request.nextUrl.searchParams.get("dotNumber"),
    content,
    filename: request.nextUrl.searchParams.get("filename"),
  };
}

function detectIngestKind(filename: string | null, content: string) {
  if (filename?.toLowerCase().endsWith(".csv")) return "all_basics" as const;
  if (content.trimStart().startsWith("<")) return "inspection_detail" as const;
  return "all_basics" as const;
}

async function registerIngest(
  serviceSupabase: ServiceSupabaseClient,
  clientId: string,
  fileHash: string,
  ingestKind: "inspection_detail" | "all_basics",
  filename: string | null,
  parsedSummary: Record<string, unknown>
) {
  const { error } = await serviceSupabase.from("fmcsa_ingest_files").insert({
    client_id: clientId,
    file_hash: fileHash,
    ingest_kind: ingestKind,
    filename,
    parsed_summary: parsedSummary,
  });
  return error
    ? NextResponse.json({ error: `Ingest registry failed: ${error.message}` }, { status: 500 })
    : null;
}

function inspectionPayload(
  clientId: string,
  dotNumber: string,
  inspection: InspectionDetailInspection
) {
  return {
    client_id: clientId,
    dot_number: dotNumber,
    mcmis_inspection_id: inspection.mcmisInspectionId,
    report_number: inspection.reportNumber,
    inspection_date: inspection.inspectionDate,
    state: inspection.state,
    level: inspection.level,
    facility_name: inspection.facilityName,
    start_time: inspection.startTime,
    end_time: inspection.endTime,
    location_text: inspection.locationText,
    post_accident_indicator: inspection.postAccidentIndicator,
    time_weight: inspection.timeWeight,
    total_violations: inspection.violations.length,
    oos_violations: inspection.violations.filter((violation) => violation.oosViolation).length,
    raw_data: inspection.rawData,
  };
}

function unmatchedCodes(inspections: InspectionDetailInspection[]) {
  return [
    ...new Set(
      inspections.flatMap((inspection) =>
        inspection.violations
          .filter(
            (violation) =>
              violation.basicCategory === null && violation.severityWeight === null
          )
          .map((violation) => violation.violationCode)
      )
    ),
  ].sort();
}

function stringOrNull(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : null;
}

type InspectionVehicleCandidate = {
  inspection_id: string;
  client_id: string;
  unit_number: number | null;
  unit_type: string | null;
  make: string | null;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  iep_dot: string | null;
};

function planVehicleWrites(
  existingRows: InspectionVehicleIdentity[],
  incomingRows: InspectionVehicleCandidate[]
) {
  const existingByKey = new Map<string, InspectionVehicleIdentity>();
  for (const row of existingRows) {
    const keys = vehicleKeys(row);
    for (const key of keys) {
      const prior = existingByKey.get(key);
      if (prior && prior.id !== row.id) {
        throw new Error(`Ambiguous existing inspection vehicle key: ${key}`);
      }
      existingByKey.set(key, row);
    }
  }

  const incomingKeys = new Set<string>();
  const matchedExistingIds = new Set<string>();
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const inserts: InspectionVehicleCandidate[] = [];

  for (const incoming of incomingRows) {
    const keys = vehicleKeys(incoming);
    if (keys.length === 0) {
      throw new Error(
        `Inspection vehicle for ${incoming.inspection_id} lacks a stable unit, VIN, or plate key`
      );
    }
    for (const key of keys) {
      if (incomingKeys.has(key)) {
        throw new Error(`Ambiguous incoming inspection vehicle key: ${key}`);
      }
      incomingKeys.add(key);
    }

    const matches = [
      ...new Map(
        keys
          .map((key) => existingByKey.get(key))
          .filter((row): row is InspectionVehicleIdentity => Boolean(row))
          .map((row) => [row.id, row])
      ).values(),
    ];
    if (matches.length > 1) {
      throw new Error(
        `Inspection vehicle keys resolve to multiple existing rows: ${keys.join(", ")}`
      );
    }

    const existing = matches[0];
    if (!existing) {
      inserts.push(incoming);
      continue;
    }
    if (matchedExistingIds.has(existing.id)) {
      throw new Error(`Multiple incoming vehicles resolve to existing row ${existing.id}`);
    }
    matchedExistingIds.add(existing.id);
    updates.push({
      id: existing.id,
      payload: buildSourceUpdate({
        unit_number: incoming.unit_number,
        unit_type: incoming.unit_type,
        make: incoming.make,
        vin: incoming.vin,
        license_plate: incoming.license_plate,
        license_state: incoming.license_state,
        iep_dot: incoming.iep_dot,
      }),
    });
  }

  return { updates, inserts };
}

function vehicleKeys(
  row: Pick<
    InspectionVehicleCandidate,
    "inspection_id" | "unit_number" | "vin" | "license_plate" | "license_state"
  >
) {
  const prefix = row.inspection_id;
  const keys: string[] = [];
  if (row.unit_number !== null) keys.push(`${prefix}:unit:${row.unit_number}`);
  if (row.vin?.trim()) keys.push(`${prefix}:vin:${row.vin.trim().toUpperCase()}`);
  if (row.license_plate?.trim()) {
    keys.push(
      `${prefix}:plate:${row.license_state?.trim().toUpperCase() ?? ""}:` +
        row.license_plate.trim().toUpperCase()
    );
  }
  return keys;
}
