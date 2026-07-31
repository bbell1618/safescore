import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcileLaneBEvidenceRequests } from "@/lib/evidence-loop/server";
import { syncClientEvidenceRequest } from "@/lib/request-queue/sync";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const schema = z.object({
  clientId: z.string().uuid(),
  violationId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clientId, violationId } = parsed.data;
  const supabase = getAdmin();

  const { data: violation, error: violationError } = await supabase
    .from("violations")
    .select("id, client_id, inspection_id, challenge_priority")
    .eq("id", violationId)
    .eq("client_id", clientId)
    .single();
  if (violationError || !violation) {
    return NextResponse.json(
      { error: violationError?.message ?? "Violation does not belong to client" },
      { status: 404 }
    );
  }

  // Check existing case for this violation
  const { data: existing } = await supabase
    .from("dataq_cases")
    .select("id")
    .eq("violation_id", violationId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing) {
    const reconciled = await reconcileLaneBEvidenceRequests(supabase, {
      clientId,
      violationIds: [violationId],
      trigger: "case_open",
    });
    if (reconciled.errors.length > 0) {
      return NextResponse.json(
        { error: `Case exists, but evidence sync failed: ${reconciled.errors.join(" | ")}` },
        { status: 500 }
      );
    }
    try {
      await syncClientEvidenceRequest(supabase, clientId);
    } catch (error) {
      return NextResponse.json(
        {
          error: `Case exists, but consolidated evidence sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ caseId: existing.id, existing: true });
  }

  const { data: newCase, error } = await supabase
    .from("dataq_cases")
    .insert({
      client_id: clientId,
      violation_id: violationId,
      inspection_id: violation?.inspection_id ?? null,
      status: "draft",
      priority: violation?.challenge_priority ?? "medium",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reconciled = await reconcileLaneBEvidenceRequests(supabase, {
    clientId,
    violationIds: [violationId],
    trigger: "case_open",
  });
  if (reconciled.errors.length > 0) {
    return NextResponse.json(
      { error: `Case was created, but evidence sync failed: ${reconciled.errors.join(" | ")}` },
      { status: 500 }
    );
  }
  try {
    await syncClientEvidenceRequest(supabase, clientId);
  } catch (syncError) {
    return NextResponse.json(
      {
        error: `Case was created, but consolidated evidence sync failed: ${
          syncError instanceof Error ? syncError.message : String(syncError)
        }`,
      },
      { status: 500 }
    );
  }

  const { data: activity, error: activityError } = await supabase
    .from("activity_log")
    .insert({
      client_id: clientId,
      action_type: "case_created",
      entity_type: "dataq_cases",
      entity_id: newCase.id,
      description: `DataQs case created for violation ${violationId}`,
    })
    .select("id")
    .maybeSingle();
  if (activityError || !activity) {
    return NextResponse.json(
      {
        error: `Case was created, but activity logging failed: ${
          activityError?.message ?? "row not inserted"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ caseId: newCase.id });
}
