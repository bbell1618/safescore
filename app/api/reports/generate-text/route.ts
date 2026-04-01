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

export async function POST(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────────
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
    .single() as any;

  const role: string = userRecord?.role ?? "client_user";

  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────────
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

  // ── 3. Fetch client ──────────────────────────────────────────────────────────
  const { data: client, error: clientError } = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, mc_number")
    .eq("id", clientId)
    .single() as any;

  if (clientError || !client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // ── 4. Fetch BASIC scores from score_snapshots ───────────────────────────────
  const { data: snapshots } = await serviceSupabase
    .from("score_snapshots")
    .select("basic_category, measure_value, percentile, alert_indicator, snapshot_date")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(7) as any;

  // ── 5. Fetch violation summary from violations table ─────────────────────────
  const { data: allViolations } = await serviceSupabase
    .from("violations")
    .select("challengeable, basic_category")
    .eq("client_id", clientId) as any;

  const totalViolations = (allViolations ?? []).length;
  const challengeableCount = (allViolations ?? []).filter((v: any) => v.challengeable === true).length;

  // Top BASIC categories by frequency
  const categoryCounts: Record<string, number> = {};
  for (const v of allViolations ?? []) {
    if (v.basic_category) {
      categoryCounts[v.basic_category] = (categoryCounts[v.basic_category] ?? 0) + 1;
    }
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // ── 6. Build prompt text ─────────────────────────────────────────────────────
  const basicsText = (snapshots ?? [])
    .map((s: any) => {
      const alert = s.alert_indicator === "Y" ? " [ALERT]" : "";
      const pct = s.percentile != null ? ` (${s.percentile}th percentile)` : "";
      return `- ${s.basic_category}: ${s.measure_value ?? "N/A"}${pct}${alert}`;
    })
    .join("\n") || "No BASIC score data available.";

  const reportLabel = typeLabels[type] ?? type;
  const violationSummary = totalViolations > 0
    ? `${totalViolations} total violations, ${challengeableCount} potentially challengeable. Top BASIC categories: ${topCategories.join(", ") || "none identified"}.`
    : "No violations on record.";

  const typeInstructions: Record<string, string> = {
    assessment: "Write an initial safety assessment covering carrier overview, current risk profile, BASIC score analysis, violation patterns, and recommended next steps.",
    monthly: "Write a monthly progress report covering recent score changes, new violations, open case updates, and the priority focus for next month.",
    quarterly: "Write a comprehensive quarterly re-analysis with before/after comparison of safety metrics, remediation progress, and updated recommendations.",
    improvement: "Write an improvement report summarizing score improvements achieved since baseline, challengeable violations resolved, and insurance re-marketing context.",
    underwriter: "Write a carrier-ready underwriter report documenting remediation work completed, current BASIC standing, and evidence of safety improvement for submission to insurance carriers.",
  };

  const prompt = `You are a trucking safety consultant writing a professional report for a carrier client. Write approximately 500 words.

Carrier: ${client.name} (DOT ${dotNumber}${client.mc_number ? `, MC ${client.mc_number}` : ""})
Report type: ${reportLabel}

BASIC Scores:
${basicsText}

Violation Summary: ${violationSummary}

Instructions: ${typeInstructions[type] ?? typeInstructions.assessment}

Write in plain English accessible to a small fleet owner. Use professional but approachable tone. Structure with clear paragraphs — no bullet lists. Do not include legal opinions or guarantees.`;

  // ── 7. Call OpenRouter (or fallback template) ─────────────────────────────────
  let aiText: string;

  if (!process.env.OPENROUTER_API_KEY) {
    aiText = `[DRAFT — AI generation requires OPENROUTER_API_KEY]

${reportLabel} — ${client.name} (DOT ${dotNumber})
Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}

This is a placeholder draft. Configure OPENROUTER_API_KEY to enable AI-generated reports.

Carrier overview: ${client.name} operates under DOT ${dotNumber}.

BASIC scores summary:
${basicsText}

Violations: ${violationSummary}

Recommendations: Review open violations and consider DataQs challenges for any errors. Run full analysis to identify remediation opportunities.`;
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

      const data = await response.json();
      aiText = data.choices?.[0]?.message?.content ?? "";
      if (!aiText) throw new Error("Empty response from AI");
    } catch (err) {
      console.error("OpenRouter call failed:", err);
      return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
    }
  }

  // ── 8. Save draft to reports table ──────────────────────────────────────────
  const { data: report, error: reportError } = await serviceSupabase
    .from("reports")
    .insert({
      client_id: clientId,
      type,
      title: `${reportLabel} — ${client.name}`,
      status: "draft",
      final_content: aiText,
    })
    .select("id")
    .single() as any;

  if (reportError) {
    console.warn("Could not save report draft:", reportError);
    // Non-fatal — return the content anyway
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
