import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { draftCpdpNarrative, EvidenceFile } from "@/lib/ai/openrouter";
import { NextResponse } from "next/server";
import { narrativeBlockReason } from "@/lib/analysis/narrative-sentinels";
import { sendCaseStatusChange } from "@/lib/email/client";
import { emitCaseResolutionAlert } from "@/lib/monitoring/alerts";
import { z } from "zod";

export const maxDuration = 60;

const CPDP_RESOLUTION_STATUSES = new Set(["determination_made", "closed"]);

const patchSchema = z.object({
  status: z.enum(["draft", "filed", "pending", "determination_made", "closed"]).optional(),
  filed_date: z.string().date().nullable().optional(),
  determination_date: z.string().date().nullable().optional(),
  outcome: z.enum(["not_preventable", "preventable", "undecided", "dismissed"]).nullable().optional(),
  final_narrative: z.string().max(12000).nullable().optional(),
  filing_notes: z.string().max(12000).nullable().optional(),
  case_number: z.string().max(255).nullable().optional(),
  cpdp_eligible_types: z.array(z.string().min(1).max(500)).max(21).nullable().optional(),
  narrative_evidence_verified: z.boolean().optional(),
  narrative_verified_at: z.string().datetime({ offset: true }).nullable().optional(),
  narrative_verified_by: z.string().max(255).nullable().optional(),
  par_identity_confirmed: z.boolean().optional(),
  par_confirmed_at: z.string().datetime({ offset: true }).nullable().optional(),
  par_confirmed_by: z.string().max(255).nullable().optional(),
}).strict();

/**
 * Strip the AI's PAR identity reconciliation preamble from generated narratives.
 *
 * When PAR identity is auto-detected, the model emits a preamble like:
 *   "**PAR Identity Verification:** Confirmed. (1) USDOT ... (3) location ... Proceeding.\n\n---\n\n"
 * before the actual RFD header. This preamble is the model's internal verification
 * trace — it should not appear in the filed narrative or the review textarea.
 *
 * Strategy: find the first "REQUEST FOR DETERMINATION" header (with optional markdown
 * bold wrappers) and return everything from that point forward. If no header is found,
 * the narrative is returned as-is so we never silently drop content.
 */
function stripCpdpPreamble(narrative: string): string {
  const match = narrative.match(/\*{0,2}REQUEST\s+FOR\s+DETERMINATION/i);
  if (!match || match.index === undefined) return narrative;
  return narrative.slice(match.index).trim();
}

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── PATCH — update case fields ──────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid CPDP case update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const supabase = getAdmin();
  const { data: beforeCase, error: beforeError } = await supabase
    .from("cpdp_cases")
    .select("status, outcome, case_number, client_id, par_ai_assessment, par_assessment_status, clients(name), crashes(par_document_id)")
    .eq("id", id)
    .single();

  if (beforeError || !beforeCase) {
    return NextResponse.json(
      { error: beforeError?.message ?? "CPDP case not found" },
      { status: beforeError?.code === "PGRST116" ? 404 : 500 }
    );
  }

  const beforeCrash = Array.isArray(beforeCase.crashes)
    ? beforeCase.crashes[0]
    : beforeCase.crashes;
  const reviewControlledWrite =
    body.cpdp_eligible_types !== undefined ||
    body.par_identity_confirmed !== undefined ||
    body.par_confirmed_at !== undefined ||
    body.par_confirmed_by !== undefined ||
    body.narrative_evidence_verified !== undefined ||
    body.narrative_verified_at !== undefined ||
    body.narrative_verified_by !== undefined;
  if (reviewControlledWrite) {
    return NextResponse.json(
      { error: "Use the PAR determination review to approve identity, eligibility, and evidence-verification fields." },
      { status: 409 }
    );
  }
  if (
    body.final_narrative !== undefined &&
    (!beforeCrash?.par_document_id || beforeCase.par_assessment_status !== "approved")
  ) {
    return NextResponse.json(
      { error: "Approve the PAR determination review before saving a final narrative." },
      { status: 409 }
    );
  }

  // Narrative sentinel gate — block final_narrative save if it contains sentinels
  if (body.final_narrative !== undefined && typeof body.final_narrative === "string") {
    const blockReason = narrativeBlockReason(body.final_narrative);
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 400 });
    }
  }

  // Server-side filing gate
  if (body.status === "filed") {
    // Narrative sentinel check on current case narrative
    const { data: caseRow } = await supabase
      .from("cpdp_cases")
      .select("final_narrative, ai_narrative, par_assessment_status, crashes(par_document_id)")
      .eq("id", id)
      .single();

    const activeNarrative =
      caseRow?.final_narrative ?? caseRow?.ai_narrative;
    const narrativeBlock = narrativeBlockReason(activeNarrative ?? undefined);
    if (narrativeBlock) {
      return NextResponse.json(
        { error: "Cannot file: " + narrativeBlock },
        { status: 400 }
      );
    }

    const crashRelation = Array.isArray(caseRow?.crashes)
      ? caseRow.crashes[0]
      : caseRow?.crashes;
    if (!crashRelation?.par_document_id) {
      return NextResponse.json(
        { error: "Cannot file: a linked Police Accident Report is required." },
        { status: 403 }
      );
    }
    if (caseRow?.par_assessment_status !== "approved") {
      return NextResponse.json(
        { error: "Cannot file: the PAR identity and 21-question assessment must be reviewed and approved." },
        { status: 403 }
      );
    }
  }

  const { data: afterCase, error } = await supabase
    .from("cpdp_cases")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("status, outcome, case_number, client_id, clients(name)")
    .single();

  if (error || !afterCase) {
    return NextResponse.json(
      { error: error?.message ?? "CPDP case update returned no row" },
      { status: 500 }
    );
  }

  // Activity log on status change
  if (body.status) {
    await supabase.from("activity_log").insert({
      client_id: afterCase.client_id,
      action_type: `cpdp_case_${body.status}`,
      entity_type: "cpdp_cases",
      entity_id: id,
      description: `CPDP case status updated to ${body.status}`,
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
        caseType: "CPDP",
        caseNumber: beforeCase.case_number ?? undefined,
        oldStatus: beforeCase.status,
        newStatus: afterCase.status,
        portalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"}/portal/activity#cases`,
      });
    }

    if (CPDP_RESOLUTION_STATUSES.has(afterCase.status)) {
      try {
        await emitCaseResolutionAlert(supabase, {
          clientId: afterCase.client_id,
          caseType: "CPDP",
          caseId: id,
          caseNumber: afterCase.case_number,
          status: afterCase.status,
          outcome: afterCase.outcome,
        });
      } catch (alertError) {
        const message =
          alertError instanceof Error
            ? alertError.message
            : "Unable to emit CPDP resolution alert";
        console.error("CPDP resolution alert failed:", message);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// ─── POST — generate AI narrative ────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  try {
    // Fetch case with crash + client (par_identity_confirmed passed to narrative prompt)
    const { data: c } = await supabase
      .from("cpdp_cases")
      .select(
        "*, cpdp_eligible_types, par_identity_confirmed, crashes(crash_date, city, state, report_number, fatalities, injuries, tow_away, hazmat_release, par_document_id), clients(name, dot_number)"
      )
      .eq("id", id)
      .single();

    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const crash = c.crashes as {
      crash_date: string;
      city: string;
      state: string;
      report_number: string;
      fatalities: number;
      injuries: number;
      tow_away: boolean;
      hazmat_release: boolean;
      par_document_id: string | null;
    } | null;

    const client = c.clients as { name: string; dot_number: string } | null;

    if (!client) {
      return NextResponse.json({ error: "Client data missing" }, { status: 400 });
    }
    if (!crash) {
      return NextResponse.json({ error: "Crash data missing" }, { status: 400 });
    }
    if (!crash.par_document_id) {
      return NextResponse.json(
        { error: "Awaiting police report — upload or LexisNexis delivery" },
        { status: 409 }
      );
    }
    if (c.par_assessment_status !== "approved") {
      return NextResponse.json(
        { error: "Approve the PAR identity and 21-question assessment before regenerating the filing narrative." },
        { status: 409 }
      );
    }

    // Fetch evidence items
    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("cpdp_evidence")
      .select("label, doc_type, fmcsa_category, status, storage_path, document_id")
      .eq("case_id", id);
    if (evidenceError) {
      throw new Error(`Unable to load CPDP evidence: ${evidenceError.message}`);
    }

    const isProvisional = !(evidenceRows ?? []).some(
      (e) => (e as Record<string, unknown>).status === "received"
    );

    // Download received evidence files for document grounding
    const evidenceFiles: EvidenceFile[] = [];
    let loadedPoliceReport = false;
    const receivedRows = (evidenceRows ?? []).filter((e) => {
      const row = e as Record<string, unknown>;
      return row.status === "received" && (row.storage_path || row.document_id);
    });

    for (const row of receivedRows) {
      const evidenceRow = row as Record<string, unknown>;
      let storagePath = evidenceRow.storage_path as string | null;
      let bucket = "dataq-evidence";
      let storedMimeType: string | null = null;
      const label = evidenceRow.label as string;
      const isPoliceReport = evidenceRow.doc_type === "police_report";
      try {
        if (evidenceRow.document_id) {
          const { data: document, error: documentError } = await supabase
            .from("documents")
            .select("storage_path, mime_type")
            .eq("id", evidenceRow.document_id as string)
            .single();
          if (documentError || !document?.storage_path) {
            throw new Error(
              `Linked document could not be resolved: ${
                documentError?.message ?? "storage path missing"
              }`
            );
          }
          bucket = "documents";
          storagePath = document.storage_path as string;
          storedMimeType = document.mime_type as string | null;
        }
        if (!storagePath) throw new Error("Evidence storage path is missing");
        const { data: fileData, error: dlErr } = await supabase.storage
          .from(bucket)
          .download(storagePath);
        if (dlErr || !fileData) {
          if (isPoliceReport) {
            throw new Error(
              `Required police report could not be downloaded: ${
                dlErr?.message ?? "file unavailable"
              }`
            );
          }
          console.warn("[cpdp narrative POST] Could not download:", storagePath, dlErr?.message);
          continue;
        }
        const arrayBuf = await fileData.arrayBuffer();
        const sizeBytes = arrayBuf.byteLength;
        if (sizeBytes > 20971520) {
          if (isPoliceReport) {
            throw new Error("Required police report exceeds the 20 MB narrative-grounding limit");
          }
          console.warn("[cpdp narrative POST] Skipping oversized file:", storagePath, sizeBytes);
          continue;
        }
        const base64Data = Buffer.from(arrayBuf).toString("base64");
        const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeMap: Record<string, string> = {
          pdf: "application/pdf",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          tif: "image/tiff",
          tiff: "image/tiff",
        };
        const mimeType = storedMimeType ?? mimeMap[ext] ?? "application/octet-stream";
        evidenceFiles.push({ label, mimeType, base64Data, sizeBytes });
        if (isPoliceReport) loadedPoliceReport = true;
        console.log("[cpdp narrative POST] Loaded:", { label, mimeType, sizeBytes });
      } catch (err) {
        if (isPoliceReport) throw err;
        console.warn(
          "[cpdp narrative POST] Download exception:",
          storagePath,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (!loadedPoliceReport) {
      throw new Error("The linked police report could not be loaded for grounded narrative generation");
    }

    const eligibleTypes = (c.cpdp_eligible_types as string[] | null) ?? [];

    const rawNarrative = await draftCpdpNarrative({
      crashDate: crash.crash_date,
      state: crash.state,
      city: crash.city,
      reportNumber: crash.report_number,
      fatalities: crash.fatalities ?? 0,
      injuries: crash.injuries ?? 0,
      towAway: crash.tow_away ?? false,
      hazmatRelease: crash.hazmat_release ?? false,
      eligibleTypes,
      carrierName: client.name,
      dotNumber: client.dot_number,
      isProvisional,
      parIdentityConfirmed: (c.par_identity_confirmed as boolean | null) ?? false,
      evidenceFiles,
    });

    // Strip the PAR identity reconciliation preamble before persisting or returning.
    // The preamble ("**PAR Identity Verification:** Confirmed...") is the model's
    // internal trace — it must not appear in the filed RFD or the review textarea.
    const narrative = stripCpdpPreamble(rawNarrative);

    await supabase
      .from("cpdp_cases")
      .update({ ai_narrative: narrative, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ narrative });
  } catch (err) {
    console.error(
      "[cpdp narrative POST] Unhandled error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Narrative generation failed" },
      { status: 500 }
    );
  }
}
