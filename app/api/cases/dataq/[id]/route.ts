import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  detectEvidenceMimeType,
  draftDataqNarrative,
} from "@/lib/ai/openrouter";
import { NextResponse } from "next/server";
import { narrativeBlockReason } from "@/lib/analysis/narrative-sentinels";
import { sendCaseStatusChange } from "@/lib/email/client";
import { mapReasonCode } from "@/lib/analysis/reason-codes";
import { emitCaseResolutionAlert } from "@/lib/monitoring/alerts";

export const maxDuration = 60;

const DATAQ_RESOLUTION_STATUSES = new Set(["approved", "denied", "closed"]);

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const supabase = getAdmin();
  const { data: beforeCase, error: beforeError } = await supabase
    .from("dataq_cases")
    .select("status, outcome, case_number, client_id, clients(name)")
    .eq("id", id)
    .single();

  if (beforeError || !beforeCase) {
    return NextResponse.json(
      { error: beforeError?.message ?? "DataQ case not found" },
      { status: beforeError?.code === "PGRST116" ? 404 : 500 }
    );
  }

  // Narrative sentinel gate — block approval if narrative contains any sentinel tokens
  if (body.final_narrative !== undefined && typeof body.final_narrative === "string") {
    const blockReason = narrativeBlockReason(body.final_narrative);
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 400 });
    }
  }

  // A6 server-side filing gate
  if (body.status === "filed") {
    // Narrative sentinel gate — block filing if the current narrative has an AI refusal sentinel
    const { data: caseForNarrative } = await supabase
      .from("dataq_cases")
      .select("final_narrative, ai_narrative")
      .eq("id", id)
      .single();
    const activeNarrative =
      caseForNarrative?.final_narrative ?? caseForNarrative?.ai_narrative;
    const narrativeBlock = narrativeBlockReason(activeNarrative ?? undefined);
    if (narrativeBlock) {
      return NextResponse.json(
        { error: "Cannot file: " + narrativeBlock },
        { status: 400 }
      );
    }

    // Check whether any required evidence has been received
    const { count: receivedCount } = await supabase
      .from("dataq_evidence")
      .select("id", { count: "exact", head: true })
      .eq("case_id", id)
      .eq("required", true)
      .eq("status", "received");

    // Check whether evidence is present at all (skip gate if no evidence rows defined)
    const { count: totalCount } = await supabase
      .from("dataq_evidence")
      .select("id", { count: "exact", head: true })
      .eq("case_id", id);

    if ((totalCount ?? 0) > 0 && (receivedCount ?? 0) === 0) {
      // Check override flag on the case
      const { data: caseRow } = await supabase
        .from("dataq_cases")
        .select("filed_without_evidence")
        .eq("id", id)
        .single();

      const overrideEnabled =
        caseRow?.filed_without_evidence === true ||
        body.filed_without_evidence === true;

      if (!overrideEnabled) {
        return NextResponse.json(
          {
            error:
              "Evidence required before filing. Upload at least one required document or enable the override.",
          },
          { status: 403 }
        );
      }
    }
  }

  const { data: afterCase, error } = await supabase
    .from("dataq_cases")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("status, outcome, case_number, client_id, clients(name)")
    .single();

  if (error || !afterCase) {
    return NextResponse.json(
      { error: error?.message ?? "DataQ case update returned no row" },
      { status: 500 }
    );
  }

  // Log status change
  if (body.status) {
    await supabase.from("activity_log").insert({
      client_id: afterCase.client_id,
      action_type: `case_${body.status}`,
      entity_type: "dataq_cases",
      entity_id: id,
      description: `DataQs case status updated to ${body.status}`,
    });
  }

  const statusChanged = beforeCase.status !== afterCase.status;
  if (statusChanged) {
    const { data: recipient } = await supabase
      .from("users")
      .select("email")
      .eq("client_id", beforeCase.client_id)
      .eq("role", "client_user")
      .limit(1)
      .maybeSingle();
    const clientRelation = Array.isArray(beforeCase.clients)
      ? beforeCase.clients[0]
      : beforeCase.clients;
    if (recipient?.email) {
      await sendCaseStatusChange({
        to: recipient.email,
        companyName: clientRelation?.name ?? "Your company",
        caseType: "DataQ",
        caseNumber: beforeCase.case_number ?? undefined,
        oldStatus: beforeCase.status,
        newStatus: afterCase.status,
        portalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"}/portal/activity#cases`,
      });
    }

    if (DATAQ_RESOLUTION_STATUSES.has(afterCase.status)) {
      try {
        await emitCaseResolutionAlert(supabase, {
          clientId: afterCase.client_id,
          caseType: "DataQ",
          caseId: id,
          caseNumber: afterCase.case_number,
          status: afterCase.status,
          outcome: afterCase.outcome,
        });
      } catch (alertError) {
        const message =
          alertError instanceof Error
            ? alertError.message
            : "Unable to emit DataQ resolution alert";
        console.error("DataQ resolution alert failed:", message);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  try {
    const { data: c } = await supabase
      .from("dataq_cases")
      .select(
        "*, canonical_inspection_date, violations(violation_code, violation_description, basic_category, challenge_reason, challenge_priority), clients(name, dot_number), inspections(inspection_date, state, level, facility_name)"
      )
      .eq("id", id)
      .single();

    const { data: evidenceRows } = await supabase
      .from("dataq_evidence")
      .select("label, fmcsa_category, status, storage_path, storage_bucket")
      .eq("case_id", id);

    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const violation = c.violations as {
      violation_code: string;
      violation_description: string;
      challenge_reason: string | null;
      challenge_priority: string | null;
      basic_category: string | null;
    } | null;
    const client = c.clients as { name: string; dot_number: string } | null;
    const inspection = c.inspections as {
      inspection_date: string;
      state: string;
      level: string;
      facility_name: string;
    } | null;

    if (!client) {
      return NextResponse.json({ error: "Client data missing" }, { status: 400 });
    }

    if (!violation) {
      return NextResponse.json(
        {
          error:
            "This case has no linked violation. Re-run analysis or use the re-link button in the workbench to restore the connection.",
        },
        { status: 400 }
      );
    }

    if (!inspection) {
      return NextResponse.json(
        {
          error:
            "This case has no linked inspection. Re-run analysis to restore the connection.",
        },
        { status: 400 }
      );
    }

    const evidenceItems = (evidenceRows ?? []).map((e) => {
      const row = e as Record<string, unknown>;
      return {
        label: (row.label as string) ?? "",
        fmcsa_category: (row.fmcsa_category as string | null) ?? "",
        status: (row.status as string) as "requested" | "received",
      };
    });
    const isProvisional = !evidenceItems.some((e) => e.status === "received");
    const reasonCode = mapReasonCode({
      challengeReason: violation.challenge_reason,
      violationCode: violation.violation_code,
      basicCategory: violation.basic_category,
    });

    // Download received evidence files for document grounding
    const evidenceFiles: Array<{
      label: string;
      mimeType: string;
      base64Data: string;
      sizeBytes: number;
    }> = [];

    const receivedRows = (evidenceRows ?? []).filter(
      (e) => (e as Record<string, unknown>).status === 'received' &&
              (e as Record<string, unknown>).storage_path
    );

    for (const row of receivedRows) {
      const storagePath = (row as Record<string, unknown>).storage_path as string;
      const label = (row as Record<string, unknown>).label as string;
      const storageBucket =
        ((row as Record<string, unknown>).storage_bucket as string | null) ??
        "dataq-evidence";
      if (!new Set(["documents", "dataq-evidence"]).has(storageBucket)) {
        return NextResponse.json(
          { error: `Evidence ${label} references an unsupported storage bucket.` },
          { status: 500 }
        );
      }
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from(storageBucket)
          .download(storagePath);
        if (dlErr || !fileData) {
          return NextResponse.json(
            {
              error: `Received evidence ${label} could not be downloaded: ${
                dlErr?.message ?? "empty storage response"
              }`,
            },
            { status: 500 }
          );
        }
        const arrayBuf = await fileData.arrayBuffer();
        const sizeBytes = arrayBuf.byteLength;
        if (sizeBytes > 20971520) { // 20MB hard cap
          return NextResponse.json(
            { error: `Received evidence ${label} exceeds the 20 MB narrative limit.` },
            { status: 422 }
          );
        }
        const bytes = Buffer.from(arrayBuf);
        const mimeType = detectEvidenceMimeType(bytes);
        if (!mimeType) {
          return NextResponse.json(
            {
              error: `Received evidence ${label} has unsupported or corrupt file contents.`,
            },
            { status: 422 }
          );
        }
        const base64Data = bytes.toString("base64");
        evidenceFiles.push({ label, mimeType, base64Data, sizeBytes });
        console.log('[narrative POST] Evidence file loaded:', {
          label,
          mimeType,
          sizeBytes,
          storagePath,
        });
      } catch (err) {
        return NextResponse.json(
          {
            error: `Received evidence ${label} could not be read: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
          { status: 500 }
        );
      }
    }

    console.log(
      "[narrative POST] Generating for case:",
      id,
      "canonical date:",
      c.canonical_inspection_date,
      "evidence count:",
      evidenceItems.length,
      "files loaded:",
      evidenceFiles.length
    );

    console.log(
      '[narrative POST] Calling draftDataqNarrative with',
      evidenceFiles.length,
      'files:',
      evidenceFiles.map(f => ({ label: f.label, mimeType: f.mimeType, sizeBytes: f.sizeBytes }))
    );

    const canonicalInspectionDate =
      (c.canonical_inspection_date as string | null) ?? inspection.inspection_date;
    const narrative = evidenceFiles.length === 0
      ? "INSUFFICIENT EVIDENCE: No received evidence file could be loaded. Collect and verify supporting documentation before drafting or filing this challenge."
      : await draftDataqNarrative({
      violationCode: violation.violation_code,
      violationDescription: violation.violation_description,
      inspectionDate: canonicalInspectionDate,
      state: inspection.state,
      inspectionLevel: inspection.level,
      facilityName: inspection.facility_name,
      challengeReason: violation.challenge_reason ?? "No challenge basis has been documented",
      suggestedApproach: `${reasonCode.label}: ${reasonCode.description}`,
      carrierName: client.name,
      dotNumber: client.dot_number,
      evidenceItems,
      isProvisional,
      evidenceFiles,
    });

    console.log("[narrative POST] Narrative generated, length:", narrative.length);

    // Save AI narrative to the case record
    await supabase
      .from("dataq_cases")
      .update({
        ai_narrative: narrative,
        canonical_inspection_date: canonicalInspectionDate,
        dataqs_reason_code: reasonCode.code,
      })
      .eq("id", id);

    return NextResponse.json({ narrative });
  } catch (err) {
    console.error(
      "[narrative POST] Unhandled error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Narrative generation failed" },
      { status: 500 }
    );
  }
}
