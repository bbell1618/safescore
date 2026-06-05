import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const postSchema = z.object({ action: z.literal("generate") });

type EvidenceItem = {
  doc_type: string;
  label: string;
  context_note: string;
  fmcsa_category: string;
  required: boolean;
};

/** CPDP evidence checklist — same regardless of crash type.
 *  PAR is REQUIRED; all others are optional-but-strong. */
function buildCpdpEvidenceItems(crashDate: string, state: string): EvidenceItem[] {
  return [
    {
      doc_type: "police_report",
      label: "Police Accident Report (PAR)",
      fmcsa_category: "Police Accident Report",
      context_note: `Official PAR for the ${crashDate} crash in ${state}. FMCSA will not review a CPDP submission without a PAR.`,
      required: true,
    },
    {
      doc_type: "dashcam",
      label: "Dashcam / video footage",
      fmcsa_category: "Dashcam / Video Evidence",
      context_note: "In-cab or external dashcam recording of the crash event",
      required: false,
    },
    {
      doc_type: "photos",
      label: "Scene and vehicle damage photographs",
      fmcsa_category: "Photographs",
      context_note: "Photos of the crash scene, vehicles, road conditions, and any relevant signage",
      required: false,
    },
    {
      doc_type: "statement",
      label: "Driver or witness statements",
      fmcsa_category: "Statements",
      context_note: "Written statements from the driver, eyewitnesses, or other parties",
      required: false,
    },
  ];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("cpdp_evidence")
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, uploaded_at, uploaded_by"
    )
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ evidence: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Idempotency — return existing if already generated
  const { data: existing, error: existingError } = await supabase
    .from("cpdp_evidence")
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, uploaded_at, uploaded_by"
    )
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return NextResponse.json({ evidence: existing, generated: 0, alreadyExisted: true });
  }

  // Fetch crash data for context labels
  const { data: c } = await supabase
    .from("cpdp_cases")
    .select("id, crashes(crash_date, state)")
    .eq("id", id)
    .single();

  const crashRaw = c?.crashes as unknown;
  const crash = (Array.isArray(crashRaw) ? crashRaw[0] : crashRaw) as {
    crash_date: string;
    state: string;
  } | null;

  const crashDate = crash?.crash_date ?? "the crash date";
  const state = crash?.state ?? "the crash state";

  const items = buildCpdpEvidenceItems(crashDate, state).map((item) => ({
    ...item,
    case_id: id,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("cpdp_evidence")
    .insert(items)
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, uploaded_at, uploaded_by"
    );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ evidence: inserted ?? [], generated: inserted?.length ?? 0 });
}
