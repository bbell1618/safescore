import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["assessment", "monthly", "quarterly", "improvement", "underwriter"]),
  content: z.string(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, type, content } = parsed.data;
  const supabase = await createServiceClient();

  const typeLabels: Record<string, string> = {
    assessment: "Initial assessment report",
    monthly: "Monthly progress report",
    quarterly: "Quarterly re-analysis",
    improvement: "Improvement report",
    underwriter: "Underwriter report",
  };

  const { data, error } = await supabase
    .from("reports")
    .insert({
      client_id: clientId,
      type,
      title: typeLabels[type] ?? type,
      status: "reviewed",
      final_content: content,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("activity_log").insert({
    client_id: clientId,
    action_type: "report_generated",
    entity_type: "reports",
    entity_id: data.id,
    description: `${typeLabels[type]} generated and saved`,
  });

  return NextResponse.json({ reportId: data.id });
}
