import { createServiceClient } from "@/lib/supabase/server";
import { draftDataqNarrative } from "@/lib/ai/openrouter";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const supabase = await createServiceClient();

  const { error } = await supabase
    .from("dataq_cases")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log status change
  if (body.status) {
    const { data: c } = await supabase
      .from("dataq_cases")
      .select("client_id")
      .eq("id", id)
      .single();

    await supabase.from("activity_log").insert({
      client_id: c?.client_id,
      action_type: `case_${body.status}`,
      entity_type: "dataq_cases",
      entity_id: id,
      description: `DataQs case status updated to ${body.status}`,
    });

    // TODO: Send case status change email via sendCaseStatusChange() from @/lib/email/client.
    // Need to: (1) fetch the client's portal user email from the users table using c.client_id,
    // (2) fetch the client name and previous case status, (3) call sendCaseStatusChange with
    // { to, companyName, caseType: "DataQ", caseNumber, oldStatus, newStatus, portalUrl }.
    // Gate on meaningful transitions only (e.g. filed → approved/denied, not every draft update).
  }

  return NextResponse.json({ ok: true });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // POST to /api/cases/dataq/[id]/narrative — but we handle sub-routes via slug
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: c } = await supabase
    .from("dataq_cases")
    .select("*, violations(violation_code, violation_description, challenge_reason, challenge_priority), clients(name, dot_number), inspections(inspection_date, state, level, facility_name)")
    .eq("id", id)
    .single();

  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const violation = c.violations as { violation_code: string; violation_description: string; challenge_reason: string | null; challenge_priority: string | null } | null;
  const client = c.clients as { name: string; dot_number: string } | null;
  const inspection = c.inspections as { inspection_date: string; state: string; level: string; facility_name: string } | null;

  if (!violation || !client || !inspection) {
    return NextResponse.json({ error: "Missing case data" }, { status: 400 });
  }

  const narrative = await draftDataqNarrative({
    violationCode: violation.violation_code,
    violationDescription: violation.violation_description,
    inspectionDate: inspection.inspection_date,
    state: inspection.state,
    inspectionLevel: inspection.level,
    facilityName: inspection.facility_name,
    challengeReason: violation.challenge_reason ?? "Violation was incorrectly recorded",
    suggestedApproach: `Challenge based on ${violation.challenge_priority ?? "medium"} priority assessment`,
    carrierName: client.name,
    dotNumber: client.dot_number,
  });

  // Save AI narrative
  await supabase
    .from("dataq_cases")
    .update({ ai_narrative: narrative })
    .eq("id", id);

  return NextResponse.json({ narrative });
}
