import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SafetyReport } from "@/lib/pdf/safety-report";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type CaseKind = "CPDP" | "DataQ";

type UserRow = {
  role: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
  city: string | null;
  state: string | null;
  tier: ClientTier | null;
};

type CarrierSummary = {
  legalName: string;
  dotNumber: string;
  phyCity: string;
  phyState: string;
  totalDrivers: number;
  totalPowerUnits: number;
  safetyRating: string | null;
  usdotStatus: string | null;
};

type ViolationRow = {
  violation_description: string | null;
  created_at: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  basic_category: string | null;
  inspections: { inspection_date: string | null } | { inspection_date: string | null }[] | null;
};

type CaseRow = {
  id: string;
  case_number: string | null;
  status: string | null;
};

type BurdenBasic = {
  basicCategory: string;
  weightedPoints: number;
  violationCount: number;
};

type BurdenResult = {
  perBasic: BurdenBasic[];
  totalPoints: number;
};

function isOpenCase(kind: CaseKind, status: string | null | undefined) {
  if (!status) return false;
  if (kind === "CPDP") return status === "filed" || status === "pending";
  return status === "filed" || status === "pending_state" || status === "pending_fmcsa" || status === "reconsidering";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const serviceSupabase = await createServiceClient();

  const userResult = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (userResult.error) {
    return new Response(
      JSON.stringify({
        error: `Unable to verify report permissions: ${userResult.error.message}`,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const userRecord = (userResult as unknown as { data: UserRow | null }).data;

  const role: string = userRecord?.role ?? "client_user";
  if (role !== "geia_admin" && role !== "geia_staff") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { client_id?: unknown } = {};
  try {
    const input = await request.json();
    if (input && typeof input === "object" && !Array.isArray(input)) {
      body = input as { client_id?: unknown };
    }
  } catch {
    // An empty body is handled as a missing client_id below.
  }
  const clientId =
    typeof body.client_id === "string" && body.client_id.trim()
      ? body.client_id.trim()
      : null;
  if (!clientId) {
    return new Response(
      JSON.stringify({ error: "client_id is required for staff users" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const clientResult = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number, city, state, tier")
    .eq("id", clientId)
    .single();
  const { data: client, error: clientError } = clientResult as unknown as { data: ClientRow | null; error: unknown };

  if (clientError || !client) {
    return new Response(JSON.stringify({ error: "Client not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const serviceTier = normalizeClientTier(client.tier);
  const includeCaseWork = tierHasFeature(serviceTier, "case_visibility");

  let carrier: CarrierSummary = {
    legalName: client.name,
    dotNumber: client.dot_number,
    phyCity: "",
    phyState: "",
    totalDrivers: 0,
    totalPowerUnits: 0,
    safetyRating: null,
    usdotStatus: null,
  };

  const { data: carrierProfile } = await serviceSupabase
    .from("carrier_profiles")
    .select("legal_name, dot_number, drivers, power_units, safety_rating, authority_status")
    .eq("client_id", clientId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (carrierProfile) {
    carrier = {
      legalName: carrierProfile.legal_name ?? client.name,
      dotNumber: carrierProfile.dot_number ?? client.dot_number,
      phyCity: client.city ?? "",
      phyState: client.state ?? "",
      totalDrivers: carrierProfile.drivers ?? 0,
      totalPowerUnits: carrierProfile.power_units ?? 0,
      safetyRating: carrierProfile.safety_rating,
      usdotStatus: carrierProfile.authority_status,
    };
  }

  let basics: Array<{
    category: string;
    measure: number | null;
    percentile: number | null;
    alertIndicator: string | null;
  }> = [];

  const { data: scoreSnapshot } = await serviceSupabase
    .from("score_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (scoreSnapshot) {
    basics = [
      ["Unsafe Driving", scoreSnapshot.unsafe_driving_measure, scoreSnapshot.unsafe_driving_pct, scoreSnapshot.unsafe_driving_alert],
      ["Hours-of-Service Compliance", scoreSnapshot.hos_compliance_measure, scoreSnapshot.hos_compliance_pct, scoreSnapshot.hos_compliance_alert],
      ["Driver Fitness", scoreSnapshot.driver_fitness_measure, scoreSnapshot.driver_fitness_pct, scoreSnapshot.driver_fitness_alert],
      ["Controlled Substances/Alcohol", scoreSnapshot.controlled_substance_measure, scoreSnapshot.controlled_substance_pct, scoreSnapshot.controlled_substance_alert],
      ["Vehicle Maintenance", scoreSnapshot.vehicle_maint_measure, scoreSnapshot.vehicle_maint_pct, scoreSnapshot.vehicle_maint_alert],
      ["Hazardous Materials Compliance", scoreSnapshot.hm_compliance_measure, scoreSnapshot.hm_compliance_pct, scoreSnapshot.hm_compliance_alert],
      ["Crash Indicator", scoreSnapshot.crash_indicator_measure, scoreSnapshot.crash_indicator_pct, scoreSnapshot.crash_indicator_alert],
    ].map(([category, measure, percentile, alert]) => ({
      category: category as string,
      measure: measure as number | null,
      percentile: percentile as number | null,
      alertIndicator: alert ? "Y" : "N",
    }));
  }

  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(clientId, serviceSupabase);
  const violationQuery = serviceSupabase
    .from("violations")
    .select("violation_description, created_at, severity_weight, oos_violation, basic_category, inspections(inspection_date)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const [burdenRaw, violationResult, cpdpResult, dataqResult] = await Promise.all([
    getClientBurden(clientId, serviceSupabase),
    canonicalInspectionIds.length > 0
      ? violationQuery.in("inspection_id", canonicalInspectionIds)
      : violationQuery.in("inspection_id", []),
    includeCaseWork
      ? serviceSupabase
          .from("cpdp_cases")
          .select("id, case_number, status")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    includeCaseWork
      ? serviceSupabase
          .from("dataq_cases")
          .select("id, case_number, status")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const burden = burdenRaw as BurdenResult;
  const violationRows = (violationResult as unknown as { data: ViolationRow[] | null }).data ?? [];
  const cpdpRows = (cpdpResult as unknown as { data: CaseRow[] | null }).data ?? [];
  const dataqRows = (dataqResult as unknown as { data: CaseRow[] | null }).data ?? [];

  const violations: Array<{
    date: string;
    description: string;
    severity_weight: number | null;
    oos_violation: boolean;
    basic_category: string | null;
  }> = violationRows.map((v) => ({
    date: (Array.isArray(v.inspections) ? v.inspections[0]?.inspection_date : v.inspections?.inspection_date) ?? "",
    description: v.violation_description ?? "",
    severity_weight: v.severity_weight ?? null,
    oos_violation: v.oos_violation ?? false,
    basic_category: v.basic_category ?? null,
  }));

  const openCases = [
    ...cpdpRows
      .filter((row) => isOpenCase("CPDP", row.status))
      .map((row) => ({ kind: "CPDP" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
    ...dataqRows
      .filter((row) => isOpenCase("DataQ", row.status))
      .map((row) => ({ kind: "DataQ" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
  ];

  const today = new Date();
  const reportDate = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateSlug = today.toISOString().slice(0, 10);

  let pdfBuffer: Buffer;
  try {
    const reportDocument = React.createElement(SafetyReport, {
      client: {
        name: client.name,
        dot_number: client.dot_number,
        mc_number: client.mc_number ?? null,
      },
      carrier,
      basics,
      burden: {
        perBasic: burden.perBasic.map((item) => ({
          category: item.basicCategory,
          weightedPoints: item.weightedPoints,
          violationCount: item.violationCount,
        })),
        totalPoints: burden.totalPoints,
      },
      openCases,
      violations,
      reportDate,
      generatedBy: user.id,
    }) as Parameters<typeof renderToBuffer>[0];

    pdfBuffer = await renderToBuffer(reportDocument);
  } catch (e) {
    console.error("PDF render error:", e);
    return new Response(JSON.stringify({ error: "Failed to generate PDF" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: reportInsertError } = await serviceSupabase.from("reports").insert({
    client_id: clientId,
    type: "assessment",
    title: `Safety Report - ${client.name} - ${dateSlug}`,
    status: "reviewed",
    created_by: user.id,
  });
  if (reportInsertError) {
    console.error("Report record insert failed:", reportInsertError.message);
    return new Response(JSON.stringify({ error: "Failed to persist report record" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="safescore-${client.dot_number}-${dateSlug}.pdf"`,
    },
  });
}
