import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { evidenceRequirementsForViolation } from "@/lib/analysis/evidence-requirements";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { syncClientEvidenceRequest } from "@/lib/request-queue/sync";
import { reconcileLaneBEvidenceRequests } from "@/lib/evidence-loop/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  clientId: z.string().uuid(),
});

type ViolationRow = {
  id: string;
  client_id: string;
  inspection_id: string | null;
  violation_code: string;
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  convicted: boolean | null;
  citation_number: string | null;
  citation_result: string | null;
  challenge_reason: string | null;
  inspections: { inspection_date: string | null } | null;
};

type ExistingCaseRow = {
  id: string;
  status: string | null;
};

type ServiceSupabaseClient = Awaited<ReturnType<typeof createServiceClient>>;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = await requireStaff();
  if (authError) return authError;

  const { id: violationId } = await context.params;
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const serviceSupabase = await createServiceClient();
  const { data: violation, error: violationError } = await serviceSupabase
    .from("violations")
    .select(
      `id,
      client_id,
      inspection_id,
      violation_code,
      violation_description,
      basic_category,
      severity_weight,
      oos_violation,
      convicted,
      citation_number,
      citation_result,
      challenge_reason,
      inspections(inspection_date)`
    )
    .eq("id", violationId)
    .single();

  if (violationError || !violation) {
    return NextResponse.json({ error: "Violation not found" }, { status: 404 });
  }

  const violationRow = violation as unknown as ViolationRow;
  if (violationRow.client_id !== parsedBody.data.clientId) {
    return NextResponse.json({ error: "Violation does not belong to client" }, { status: 400 });
  }

  const timeWeight = timeWeightFor(
    violationRow.inspections?.inspection_date ?? null,
    new Date()
  );
  const challenge = scoreChallenge({
    violationCode: violationRow.violation_code,
    basicCategory: violationRow.basic_category,
    severityWeight: violationRow.severity_weight,
    timeWeight,
    challengeReason: violationRow.challenge_reason,
    oosViolation: violationRow.oos_violation ?? false,
    convicted: violationRow.convicted,
    citationNumber: violationRow.citation_number,
    citationResult: violationRow.citation_result,
    basicPercentile: null,
  });
  const evidenceRequirements = evidenceRequirementsForViolation(
    {
      violationCode: violationRow.violation_code,
      violationDescription: violationRow.violation_description,
      basicCategory: violationRow.basic_category,
      citationNumber: violationRow.citation_number,
      citationResult: violationRow.citation_result,
      challengeReason: violationRow.challenge_reason,
    },
    challenge
  );

  const { data: existing } = await serviceSupabase
    .from("dataq_cases")
    .select("id, status")
    .eq("violation_id", violationId)
    .maybeSingle();

  if (existing) {
    const existingCase = existing as ExistingCaseRow;
    const evidenceResult = await safeEnsureEvidenceRows(
        serviceSupabase,
        existingCase.id,
        evidenceRequirements
      );
    if (!evidenceResult.ok) {
      return NextResponse.json({ error: evidenceResult.error }, { status: 500 });
    }
    const typedRequests = await reconcileLaneBEvidenceRequests(
      serviceSupabase,
      {
        clientId: parsedBody.data.clientId,
        violationIds: [violationId],
        trigger: "case_open",
      }
    );
    if (typedRequests.errors.length > 0) {
      return NextResponse.json(
        { error: `Case exists, but evidence request sync failed: ${typedRequests.errors.join(" | ")}` },
        { status: 500 }
      );
    }
    try {
      await syncClientEvidenceRequest(serviceSupabase, parsedBody.data.clientId);
    } catch (error) {
      return NextResponse.json(
        {
          error: `Case exists, but consolidated evidence sync failed: ${
            error instanceof Error ? error.message : "unknown sync failure"
          }`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      caseId: existingCase.id,
      existing: true,
      status: existingCase.status ?? "investigating",
      tier: challenge.label,
      evidenceCount: evidenceResult.inserted,
    });
  }

  const { data: newCase, error: caseError } = await serviceSupabase
    .from("dataq_cases")
    .insert({
      client_id: parsedBody.data.clientId,
      violation_id: violationId,
      inspection_id: violationRow.inspection_id,
      status: "investigating",
      priority: challenge.label === "strong" ? "high" : challenge.label === "moderate" ? "medium" : "low",
    })
    .select("id, status")
    .single();

  if (caseError || !newCase) {
    return NextResponse.json(
      { error: caseError?.message ?? "Failed to create DataQs case" },
      { status: 500 }
    );
  }

  const newCaseRow = newCase as ExistingCaseRow;
  const evidenceResult = await safeEnsureEvidenceRows(
    serviceSupabase,
    newCaseRow.id,
    evidenceRequirements
  );
  if (!evidenceResult.ok) {
    return NextResponse.json({ error: evidenceResult.error }, { status: 500 });
  }

  const typedRequests = await reconcileLaneBEvidenceRequests(serviceSupabase, {
    clientId: parsedBody.data.clientId,
    violationIds: [violationId],
    trigger: "case_open",
  });
  if (typedRequests.errors.length > 0) {
    return NextResponse.json(
      { error: `Case was created, but evidence request sync failed: ${typedRequests.errors.join(" | ")}` },
      { status: 500 }
    );
  }
  try {
    await syncClientEvidenceRequest(serviceSupabase, parsedBody.data.clientId);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Case was created, but consolidated evidence sync failed: ${
          error instanceof Error ? error.message : "unknown sync failure"
        }`,
      },
      { status: 500 }
    );
  }

  const { data: activity, error: activityError } = await serviceSupabase
    .from("activity_log")
    .insert({
      client_id: parsedBody.data.clientId,
      action_type: "case_created",
      entity_type: "dataq_cases",
      entity_id: newCaseRow.id,
      description: `DataQs investigation opened for violation ${violationId}`,
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

  return NextResponse.json({
    caseId: newCaseRow.id,
    status: newCaseRow.status ?? "investigating",
    tier: challenge.label,
    evidenceCount: evidenceResult.inserted,
  });
}

async function safeEnsureEvidenceRows(
  serviceSupabase: ServiceSupabaseClient,
  caseId: string,
  evidenceRequirements: ReturnType<typeof evidenceRequirementsForViolation>
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  try {
    return {
      ok: true,
      inserted: await ensureEvidenceRows(serviceSupabase, caseId, evidenceRequirements),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to create evidence rows",
    };
  }
}

async function ensureEvidenceRows(
  serviceSupabase: ServiceSupabaseClient,
  caseId: string,
  evidenceRequirements: ReturnType<typeof evidenceRequirementsForViolation>
) {
  if (evidenceRequirements.length === 0) return 0;

  const { data: existing } = await serviceSupabase
    .from("dataq_evidence")
    .select("doc_type")
    .eq("case_id", caseId);
  const existingDocTypes = new Set((existing ?? []).map((row) => row.doc_type as string));

  const rows = evidenceRequirements
    .filter((item) => !existingDocTypes.has(item.docType))
    .map((item) => ({
      case_id: caseId,
      doc_type: item.docType,
      label: item.label,
      required: true,
      status: "needed",
      acquisition_method: item.acquisitionMethod,
      auto_source: item.autoSource ?? null,
      needed_reason: item.neededReason,
    }));

  if (rows.length === 0) return 0;

  const { error } = await serviceSupabase.from("dataq_evidence").insert(rows);
  if (error) {
    throw new Error(error.message);
  }
  return rows.length;
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
