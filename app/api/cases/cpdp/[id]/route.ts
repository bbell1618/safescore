import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { draftCpdpNarrative, EvidenceFile } from "@/lib/ai/openrouter";
import { NextResponse } from "next/server";
import { narrativeBlockReason } from "@/lib/analysis/narrative-sentinels";

export const maxDuration = 60;

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
  const body = await request.json();
  const supabase = getAdmin();

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
      .select("final_narrative, ai_narrative, filed_without_evidence")
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

    // Evidence gate — PAR (required evidence) must be received
    const { count: receivedCount } = await supabase
      .from("cpdp_evidence")
      .select("id", { count: "exact", head: true })
      .eq("case_id", id)
      .eq("required", true)
      .eq("status", "received");

    const { count: totalCount } = await supabase
      .from("cpdp_evidence")
      .select("id", { count: "exact", head: true })
      .eq("case_id", id);

    if ((totalCount ?? 0) > 0 && (receivedCount ?? 0) === 0) {
      const overrideEnabled =
        caseRow?.filed_without_evidence === true ||
        body.filed_without_evidence === true;

      if (!overrideEnabled) {
        return NextResponse.json(
          {
            error:
              "The Police Accident Report (PAR) must be uploaded before filing. Upload the PAR or enable the override.",
          },
          { status: 403 }
        );
      }
    }
  }

  const { error } = await supabase
    .from("cpdp_cases")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Activity log on status change
  if (body.status) {
    const { data: c } = await supabase
      .from("cpdp_cases")
      .select("client_id")
      .eq("id", id)
      .single();

    await supabase.from("activity_log").insert({
      client_id: c?.client_id,
      action_type: `cpdp_case_${body.status}`,
      entity_type: "cpdp_cases",
      entity_id: id,
      description: `CPDP case status updated to ${body.status}`,
    });
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
        "*, cpdp_eligible_types, par_identity_confirmed, crashes(crash_date, city, state, report_number, fatalities, injuries, tow_away, hazmat_release), clients(name, dot_number)"
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
    } | null;

    const client = c.clients as { name: string; dot_number: string } | null;

    if (!client) {
      return NextResponse.json({ error: "Client data missing" }, { status: 400 });
    }
    if (!crash) {
      return NextResponse.json({ error: "Crash data missing" }, { status: 400 });
    }

    // Fetch evidence items
    const { data: evidenceRows } = await supabase
      .from("cpdp_evidence")
      .select("label, fmcsa_category, status, storage_path")
      .eq("case_id", id);

    const isProvisional = !(evidenceRows ?? []).some(
      (e) => (e as Record<string, unknown>).status === "received"
    );

    // Download received evidence files for document grounding
    const evidenceFiles: EvidenceFile[] = [];
    const receivedRows = (evidenceRows ?? []).filter(
      (e) =>
        (e as Record<string, unknown>).status === "received" &&
        (e as Record<string, unknown>).storage_path
    );

    for (const row of receivedRows) {
      const storagePath = (row as Record<string, unknown>).storage_path as string;
      const label = (row as Record<string, unknown>).label as string;
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from("dataq-evidence")
          .download(storagePath);
        if (dlErr || !fileData) {
          console.warn("[cpdp narrative POST] Could not download:", storagePath, dlErr?.message);
          continue;
        }
        const arrayBuf = await fileData.arrayBuffer();
        const sizeBytes = arrayBuf.byteLength;
        if (sizeBytes > 20971520) {
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
        const mimeType = mimeMap[ext] ?? "application/octet-stream";
        evidenceFiles.push({ label, mimeType, base64Data, sizeBytes });
        console.log("[cpdp narrative POST] Loaded:", { label, mimeType, sizeBytes });
      } catch (err) {
        console.warn(
          "[cpdp narrative POST] Download exception:",
          storagePath,
          err instanceof Error ? err.message : err
        );
      }
    }

    const eligibleTypes = (c.cpdp_eligible_types as string[] | null) ?? [];

    const narrative = await draftCpdpNarrative({
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
