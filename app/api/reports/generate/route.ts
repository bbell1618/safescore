import { createServiceClient } from "@/lib/supabase/server";
import { generateAssessmentReport } from "@/lib/ai/openrouter";
import { getBasics, getOosRates } from "@/lib/fmcsa/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  clientId: z.string().uuid(),
  dotNumber: z.string(),
  carrierName: z.string(),
  type: z.enum(["assessment", "monthly", "quarterly", "improvement", "underwriter"]),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, dotNumber, carrierName, type } = parsed.data;
  const supabase = await createServiceClient();

  // Fetch carrier data
  let basics = null;
  let oos = null;
  try {
    [basics, oos] = await Promise.all([
      getBasics(dotNumber),
      getOosRates(dotNumber),
    ]);
  } catch (e) {
    console.warn("Could not fetch FMCSA data for report:", e);
  }

  // Fetch violation stats
  const { count: totalViolations } = await supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);

  const { count: challengeableViolations } = await supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("challengeable", true);

  const { count: totalCrashes } = await supabase
    .from("crashes")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);

  const { count: cpdpEligibleCrashes } = await supabase
    .from("crashes")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("cpdp_eligible", true);

  // Fetch action items
  const { data: actionItems } = await supabase
    .from("action_items")
    .select("title")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .order("projected_impact_score", { ascending: false })
    .limit(5);

  const basicsForReport = basics
    ? {
        "Unsafe Driving": basics.unsafeDriving,
        "HOS Compliance": basics.hosCompliance,
        "Driver Fitness": basics.driverFitness,
        "Controlled Substances": basics.controlledSubstances,
        "Vehicle Maintenance": basics.vehicleMaintenance,
        "HM Compliance": basics.hmCompliance,
        "Crash Indicator": basics.crashIndicator,
      }
    : {};

  const content = await generateAssessmentReport({
    carrierName,
    dotNumber,
    fleetSize: 0, // would fetch from client record
    driverCount: 0,
    basics: basicsForReport as Record<string, { measureValue: number; percentile: number | null; alert: boolean } | null>,
    oosRates: {
      vehicleOosRate: oos?.vehicleOosRate ?? null,
      driverOosRate: oos?.driverOosRate ?? null,
      hazmatOosRate: oos?.hazmatOosRate ?? null,
    },
    totalViolations: totalViolations ?? 0,
    challengeableViolations: challengeableViolations ?? 0,
    totalCrashes: totalCrashes ?? 0,
    cpdpEligibleCrashes: cpdpEligibleCrashes ?? 0,
    topActionItems: actionItems?.map((a) => a.title) ?? [],
    estimatedPremiumImpact: "Potential savings of $20,000-$100,000/year based on fleet size and score improvement",
  });

  return NextResponse.json({ content });
}
