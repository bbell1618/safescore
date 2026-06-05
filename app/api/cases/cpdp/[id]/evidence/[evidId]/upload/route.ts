import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assessCpdpEligibility } from "@/lib/ai/openrouter";
import type { EvidenceFile } from "@/lib/ai/openrouter";

// PAR assessment + narrative generation can take up to ~45s with Opus 4.8
export const maxDuration = 60;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/tiff",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/gif",
  "image/png",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
]);

const ALLOWED_EXTS = new Set([
  "pdf", "doc", "docx", "tif", "tiff", "txt", "xls", "xlsx",
  "jpg", "jpeg", "gif", "png", "mp4", "mov", "avi",
]);

const MAX_SIZE = 104857600; // 100 MB — dashcam footage can be large

// Max file size to pass to the AI for reading (8 MB — OpenRouter limit)
const AI_READ_LIMIT = 8388608;

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; evidId: string }> }
) {
  const { id, evidId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_MIMES.has(file.type) && !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({ error: "File type not allowed." }, { status: 422 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds the 100 MB size limit." }, { status: 422 });
  }

  const supabase = getAdmin();

  // Verify evidence item belongs to this case — fetch doc_type for PAR detection
  const { data: ev, error: evErr } = await supabase
    .from("cpdp_evidence")
    .select("id, case_id, doc_type")
    .eq("id", evidId)
    .eq("case_id", id)
    .single();

  if (evErr || !ev) {
    return NextResponse.json(
      { error: "Evidence item not found for this case." },
      { status: 404 }
    );
  }

  // Path prefix: cpdp-cases/ to separate from dataq evidence in the same bucket
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `cpdp-cases/${id}/${evidId}/${sanitizedName}`;

  const fileBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from("dataq-evidence")
    .upload(storagePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { error: updateErr } = await supabase
    .from("cpdp_evidence")
    .update({
      status: "received",
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      uploaded_by: "geia",
    })
    .eq("id", evidId);

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update evidence record: ${updateErr.message}` },
      { status: 500 }
    );
  }

  // ── Post-PAR pipeline ───────────────────────────────────────────────────────
  // When the Police Accident Report is uploaded, run a grounded eligibility
  // assessment via Opus 4.8 and persist results. Non-blocking — if this step
  // fails, the upload itself still succeeds.
  if ((ev as { doc_type: string }).doc_type === "police_report") {
    try {
      // Fetch crash context for the assessment prompt
      const { data: caseCtx } = await supabase
        .from("cpdp_cases")
        .select("crashes(crash_date, city, state, fatalities, injuries, tow_away, hazmat_release)")
        .eq("id", id)
        .single();

      const crashRaw = caseCtx?.crashes;
      const crashData = (Array.isArray(crashRaw) ? crashRaw[0] : crashRaw) as {
        crash_date: string;
        city: string;
        state: string;
        fatalities: number | null;
        injuries: number | null;
        tow_away: boolean | null;
        hazmat_release: boolean | null;
      } | null;

      if (crashData) {
        const sizeBytes = fileBuffer.byteLength;

        // Only pass the file to the AI if it's within the read limit
        const parFiles: EvidenceFile[] = sizeBytes <= AI_READ_LIMIT
          ? [
              {
                label: "Police_Accident_Report",
                mimeType: file.type || "application/pdf",
                base64Data: Buffer.from(fileBuffer).toString("base64"),
                sizeBytes,
              },
            ]
          : [];

        if (sizeBytes > AI_READ_LIMIT) {
          console.warn(
            `[upload] PAR file (${sizeBytes} bytes) exceeds AI read limit — running metadata-only assessment`
          );
        }

        const eligibilityResult = await assessCpdpEligibility(
          {
            crashDate: crashData.crash_date,
            state: crashData.state,
            fatalities: crashData.fatalities ?? 0,
            injuries: crashData.injuries ?? 0,
            towAway: crashData.tow_away ?? false,
            hazmatRelease: crashData.hazmat_release ?? false,
            description: `${crashData.crash_date} crash in ${crashData.city}, ${crashData.state}`,
          },
          parFiles
        );

        const verdict =
          eligibilityResult.verdict ??
          (eligibilityResult.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE");

        // ai_suggested_types: what the AI found in the PAR (preserved separately from human selection)
        // cpdp_eligible_types: pre-fill with AI suggestions so human has a starting point
        await supabase
          .from("cpdp_cases")
          .update({
            ai_suggested_types: eligibilityResult.eligibleTypes.length > 0
              ? eligibilityResult.eligibleTypes
              : null,
            ai_eligibility_verdict: verdict,
            ai_eligibility_rationale: eligibilityResult.reasoning,
            ai_assessed_at: new Date().toISOString(),
            // Pre-fill human selection with AI suggestions only when nothing is saved yet
            // (handled client-side — we still save here as a fallback for non-interactive contexts)
            cpdp_eligible_types: eligibilityResult.eligibleTypes.length > 0
              ? eligibilityResult.eligibleTypes
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        console.log(
          `[upload] PAR assessment complete for case ${id}: verdict=${verdict}, types=${eligibilityResult.eligibleTypes.length}`
        );

        return NextResponse.json({
          ok: true,
          assessment: {
            verdict,
            eligibleTypes: eligibilityResult.eligibleTypes,
            reasoning: eligibilityResult.reasoning,
            confidence: eligibilityResult.confidence,
          },
        });
      }
    } catch (assessErr) {
      console.error(
        "[upload] Post-PAR assessment failed:",
        assessErr instanceof Error ? assessErr.message : assessErr
      );
      // Upload succeeded — return ok without assessment data
      return NextResponse.json({ ok: true, assessmentError: true });
    }
  }

  return NextResponse.json({ ok: true });
}
