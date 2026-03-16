import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getCarrier, getBasics } from "@/lib/fmcsa/client";
import { SafetyReport } from "@/lib/pdf/safety-report";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // ── 1. Auth — get current user ──────────────────────────────────────────────
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

  // ── 2. Determine role and client_id ──────────────────────────────────────────
  const serviceSupabase = await createServiceClient();

  const { data: userRecord } = await serviceSupabase
    .from("users")
    .select("role, client_id")
    .eq("id", user.id)
    .single() as any;

  const role: string = userRecord?.role ?? "client_user";

  let clientId: string | null = null;

  if (role === "geia_admin") {
    // Admin passes client_id in the request body
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // empty body is fine — treat as missing client_id
    }
    clientId = body?.client_id ?? null;
    if (!clientId) {
      return new Response(JSON.stringify({ error: "client_id is required for admin users" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    // Portal user — derive client_id from their user record
    clientId = userRecord?.client_id ?? null;
    if (!clientId) {
      return new Response(JSON.stringify({ error: "No client associated with this account" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── 3. Fetch client record ───────────────────────────────────────────────────
  const { data: client, error: clientError } = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number")
    .eq("id", clientId)
    .single() as any;

  if (clientError || !client) {
    return new Response(JSON.stringify({ error: "Client not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 4. Fetch carrier data from FMCSA ────────────────────────────────────────
  let carrier: any = {
    legalName: client.name,
    dotNumber: client.dot_number,
    phyCity: "",
    phyState: "",
    totalDrivers: 0,
    totalPowerUnits: 0,
    safetyRating: null,
    usdotStatus: null,
  };

  try {
    const fmcsaCarrier = await getCarrier(client.dot_number);
    carrier = {
      legalName: fmcsaCarrier.legalName,
      dotNumber: fmcsaCarrier.dotNumber,
      phyCity: fmcsaCarrier.phyCity,
      phyState: fmcsaCarrier.phyState,
      totalDrivers: fmcsaCarrier.totalDrivers,
      totalPowerUnits: fmcsaCarrier.totalPowerUnits,
      safetyRating: fmcsaCarrier.safetyRating,
      usdotStatus: fmcsaCarrier.usdotStatus,
    };
  } catch (e) {
    console.warn("Could not fetch FMCSA carrier data:", e);
  }

  // ── 5. Fetch BASIC scores ────────────────────────────────────────────────────
  let basics: Array<{
    category: string;
    measure: number | null;
    percentile: number | null;
    alertIndicator: string | null;
  }> = [];

  try {
    const fmcsaBasics = await getBasics(client.dot_number);
    const basicEntries = [
      fmcsaBasics.unsafeDriving,
      fmcsaBasics.hosCompliance,
      fmcsaBasics.driverFitness,
      fmcsaBasics.controlledSubstances,
      fmcsaBasics.vehicleMaintenance,
      fmcsaBasics.hmCompliance,
      fmcsaBasics.crashIndicator,
    ];
    basics = basicEntries
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .map((b) => ({
        category: b.category,
        measure: b.measureValue ?? null,
        percentile: b.percentile ?? null,
        alertIndicator: b.alert ? "Y" : "N",
      }));
  } catch (e) {
    console.warn("Could not fetch FMCSA BASIC data:", e);
  }

  // ── 6. Fetch violations from Supabase ────────────────────────────────────────
  const { data: violationRows } = await serviceSupabase
    .from("violations")
    .select("date, description, severity_weight, oos_violation, challengeable, basic_category")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(50) as any;

  const violations: Array<{
    date: string;
    description: string;
    severity_weight: number | null;
    oos_violation: boolean;
    challengeable: boolean | null;
    basic_category: string | null;
  }> = (violationRows ?? []).map((v: any) => ({
    date: v.date ?? "",
    description: v.description ?? "",
    severity_weight: v.severity_weight ?? null,
    oos_violation: v.oos_violation ?? false,
    challengeable: v.challengeable ?? null,
    basic_category: v.basic_category ?? null,
  }));

  // ── 7. Build report date ─────────────────────────────────────────────────────
  const today = new Date();
  const reportDate = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateSlug = today.toISOString().slice(0, 10); // YYYY-MM-DD

  // ── 8. Render PDF to buffer ──────────────────────────────────────────────────
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(
      React.createElement(SafetyReport, {
        client: {
          name: client.name,
          dot_number: client.dot_number,
          mc_number: client.mc_number ?? null,
        },
        carrier,
        basics,
        violations,
        reportDate,
        generatedBy: user.id,
      }) as any
    );
  } catch (e) {
    console.error("PDF render error:", e);
    return new Response(JSON.stringify({ error: "Failed to generate PDF" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 9. Insert report record ──────────────────────────────────────────────────
  try {
    await serviceSupabase.from("reports").insert({
      client_id: clientId,
      report_type: "safety_score",
      title: `Safety Report — ${client.name} — ${dateSlug}`,
      status: "completed",
      generated_by: user.id,
    } as any);
  } catch (e) {
    // Non-fatal — PDF was generated, log and continue
    console.warn("Could not insert report record:", e);
  }

  // ── 10. Return PDF ───────────────────────────────────────────────────────────
  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="safescore-${client.dot_number}-${dateSlug}.pdf"`,
    },
  });
}
