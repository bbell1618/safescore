import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().uuid(),
  dotNumber: z.string(),
  type: z.enum(["assessment", "monthly", "quarterly", "improvement", "underwriter"]),
});

const typeLabels: Record<string, string> = {
  assessment: "Initial assessment report",
  monthly: "Monthly progress report",
  quarterly: "Quarterly re-analysis",
  improvement: "Improvement report",
  underwriter: "Underwriter report",
};

type CaseKind = "CPDP" | "DataQ";

type CaseRow = {
  id: string;
  case_number: string | null;
  status: string | null;
};

type CaseSummary = {
  kind: CaseKind;
  label: string;
  status: string;
};

type ClientRow = {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
};

type BurdenBasic = {
  basicCategory: string;
  weightedPoints: number;
  violationCount: number;
  label?: string | null;
};

type BurdenResult = {
  perBasic: BurdenBasic[];
  totalPoints: number;
};

type ReportRow = {
  id: string;
};

function isOpenCase(kind: CaseKind, status: string | null | undefined) {
  if (!status) return false;
  if (kind === "CPDP") return status === "filed" || status === "pending";
  return status === "filed" || status === "pending_state" || status === "pending_fmcsa" || status === "reconsidering";
}

function openCasesText(openCases: CaseSummary[]) {
  if (openCases.length === 0) {
    return "No challenge cases are open; the burden is being addressed operationally.";
  }

  return `Open challenge work: ${openCases.length} case(s) - ${openCases
    .map((item) => `${item.label} (${item.status})`)
    .join("; ")}.`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = await createServiceClient();

  const userResult = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const userRecord = (userResult as unknown as { data: { role: string | null } | null }).data;

  const role: string = userRecord?.role ?? "client_user";

  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, dotNumber, type } = parsed.data;

  const clientResult = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number")
    .eq("id", clientId)
    .single();
  const { data: client, error: clientError } = clientResult as unknown as { data: ClientRow | null; error: unknown };

  if (clientError || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const [burdenRaw, cpdpResult, dataqResult] = await Promise.all([
    getClientBurden(clientId),
    serviceSupabase
      .from("cpdp_cases")
      .select("id, case_number, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    serviceSupabase
      .from("dataq_cases")
      .select("id, case_number, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
  ]);

  const burden = burdenRaw as BurdenResult;
  const cpdpRows = (cpdpResult as unknown as { data: CaseRow[] | null }).data ?? [];
  const dataqRows = (dataqResult as unknown as { data: CaseRow[] | null }).data ?? [];

  const openCases: CaseSummary[] = [
    ...cpdpRows
      .filter((row) => isOpenCase("CPDP", row.status))
      .map((row) => ({ kind: "CPDP" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
    ...dataqRows
      .filter((row) => isOpenCase("DataQ", row.status))
      .map((row) => ({ kind: "DataQ" as const, label: row.case_number || row.id.slice(0, 8), status: row.status || "status pending" })),
  ];

  const burdenLines = burden.perBasic
    .map((item) => {
      const label = BASIC_LABELS[item.basicCategory as keyof typeof BASIC_LABELS] ?? item.label ?? item.basicCategory;
      return `- ${label}: ${item.weightedPoints} weighted points, ${item.violationCount} violation(s)`;
    })
    .join("\n") || "No scored violations in the current 24-month window.";

  const burdenText = `Total weighted points: ${burden.totalPoints}\n${burdenLines}\nFMCSA does not publish percentile rankings for low-volume carriers; SafeScore tracks the weighted violation burden that drives the BASIC measures.`;
  const challengeWorkText = openCasesText(openCases.map((item) => ({
    ...item,
    label: `${item.kind} ${item.label}`,
  })));

  const reportLabel = typeLabels[type] ?? type;

  const typeInstructions: Record<string, string> = {
    assessment: "Write an initial safety assessment covering carrier overview, current risk profile, weighted violation burden, violation patterns, and recommended next steps.",
    monthly: "Write a monthly progress report covering recent burden changes, new violations, open case updates, and the priority focus for next month.",
    quarterly: "Write a comprehensive quarterly re-analysis with before/after comparison of safety metrics, remediation progress, and updated recommendations.",
    improvement: "Write an improvement report summarizing burden improvements achieved since baseline, real challenge cases resolved, and insurance re-marketing context.",
    underwriter: "Write a carrier-ready underwriter report documenting remediation work completed, current weighted burden, and evidence of safety improvement for submission to insurance carriers.",
  };

  const prompt = `You are a trucking safety consultant writing a professional report for a carrier client. Write approximately 500 words.

Carrier: ${client.name} (DOT ${dotNumber}${client.mc_number ? `, MC ${client.mc_number}` : ""})
Report type: ${reportLabel}

Weighted violation burden:
${burdenText}

${challengeWorkText}

Instructions: ${typeInstructions[type] ?? typeInstructions.assessment}

Write in plain English accessible to a small fleet owner. Use professional but approachable tone. Structure with clear paragraphs - no bullet lists. Do not include legal opinions or guarantees.`;

  let aiText: string;

  if (!process.env.OPENROUTER_API_KEY) {
    aiText = `[DRAFT - AI generation requires OPENROUTER_API_KEY]

${reportLabel} - ${client.name} (DOT ${dotNumber})
Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}

This is a placeholder draft. Configure OPENROUTER_API_KEY to enable AI-generated reports.

Carrier overview: ${client.name} operates under DOT ${dotNumber}.

Weighted violation burden:
${burdenText}

${challengeWorkText}

Recommendations: Address the highest weighted BASIC areas operationally and continue real CPDP/DataQs work already opened for the carrier.`;
  } else {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://safescore.app",
          "X-Title": "Golden Era SafeScore",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat-v3-0324",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter error: ${response.status}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      aiText = data.choices?.[0]?.message?.content ?? "";
      if (!aiText) throw new Error("Empty response from AI");
    } catch (err) {
      console.error("OpenRouter call failed:", err);
      return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
    }
  }

  const reportResult = await serviceSupabase
    .from("reports")
    .insert({
      client_id: clientId,
      type,
      title: `${reportLabel} - ${client.name}`,
      status: "draft",
      final_content: aiText,
    })
    .select("id")
    .single();
  const { data: report, error: reportError } = reportResult as unknown as { data: ReportRow | null; error: unknown };

  if (reportError || !report) {
    console.warn("Could not save report draft:", reportError);
    return NextResponse.json({ reportId: null, content: aiText });
  }

  await serviceSupabase.from("activity_log").insert({
    client_id: clientId,
    action_type: "report_generated",
    entity_type: "reports",
    entity_id: report.id,
    description: `${reportLabel} AI draft generated`,
  });

  return NextResponse.json({ reportId: report.id, content: aiText });
}
