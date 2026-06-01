import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const postSchema = z.object({
  action: z.literal("generate"),
});

type EvidenceRow = {
  case_id: string;
  doc_type: string;
  label: string;
  context_note: string;
  fmcsa_category: string;
  required: boolean;
};

function buildEvidenceRows(
  caseId: string,
  basicCategory: string | null | undefined,
  canonicalDate: string
): EvidenceRow[] {
  const cat = (basicCategory ?? "").toLowerCase();

  if (cat === "vehicle_maintenance" || cat === "hos_compliance") {
    return [
      {
        case_id: caseId,
        doc_type: "eld_record",
        label: "ELD/driver log records",
        fmcsa_category: "Electronic Logging Device (ELD) Records",
        context_note: `Records for ${canonicalDate}`,
        required: true,
      },
      {
        case_id: caseId,
        doc_type: "vehicle_inspection",
        label: "Vehicle inspection/maintenance records",
        fmcsa_category: "Vehicle Inspection Records",
        context_note: "Records from the inspection date",
        required: false,
      },
    ];
  }

  if (cat === "driver_fitness") {
    return [
      {
        case_id: caseId,
        doc_type: "driver_log",
        label: "Driver qualification file",
        fmcsa_category: "Driver Qualification File",
        context_note: "Driver file at time of inspection",
        required: true,
      },
      {
        case_id: caseId,
        doc_type: "driver_log",
        label: "Medical certification",
        fmcsa_category: "Medical Certificate",
        context_note: `Current at time of ${canonicalDate}`,
        required: false,
      },
    ];
  }

  if (cat === "unsafe_driving") {
    return [
      {
        case_id: caseId,
        doc_type: "eld_record",
        label: "ELD location/speed data",
        fmcsa_category: "Electronic Logging Device (ELD) Records",
        context_note: `GPS/speed records for ${canonicalDate}`,
        required: true,
      },
    ];
  }

  if (cat === "controlled_substance") {
    return [
      {
        case_id: caseId,
        doc_type: "driver_log",
        label: "Drug/alcohol test records",
        fmcsa_category: "Drug and Alcohol Testing Records",
        context_note: `Testing records relevant to ${canonicalDate}`,
        required: true,
      },
    ];
  }

  if (cat === "hazmat_compliance") {
    return [
      {
        case_id: caseId,
        doc_type: "bol",
        label: "Hazmat shipping papers/placards",
        fmcsa_category: "Bill of Lading/Shipping Papers",
        context_note: `From ${canonicalDate} shipment`,
        required: true,
      },
    ];
  }

  // Default
  return [
    {
      case_id: caseId,
      doc_type: "other",
      label: "Inspection report documentation",
      fmcsa_category: "Other",
      context_note: `Supporting documentation for ${canonicalDate} inspection`,
      required: true,
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
    .from("dataq_evidence")
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

  // Idempotency check — return existing rows if already generated
  const { data: existing, error: existingError } = await supabase
    .from("dataq_evidence")
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, uploaded_at, uploaded_by"
    )
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return NextResponse.json({ evidence: existing, generated: 0 });
  }

  // Fetch case with violation + inspection data
  const { data: c, error: caseError } = await supabase
    .from("dataq_cases")
    .select(
      "id, canonical_inspection_date, violations(basic_category), inspections(inspection_date)"
    )
    .eq("id", id)
    .single();

  if (caseError || !c) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const violationRaw = c.violations as unknown;
  const violation = (
    Array.isArray(violationRaw) ? violationRaw[0] : violationRaw
  ) as { basic_category: string | null } | null;
  const inspectionRaw = c.inspections as unknown;
  const inspection = (
    Array.isArray(inspectionRaw) ? inspectionRaw[0] : inspectionRaw
  ) as { inspection_date: string } | null;

  const canonicalDate: string =
    (c.canonical_inspection_date as string | null) ??
    inspection?.inspection_date ??
    "unknown date";

  const rows = buildEvidenceRows(id, violation?.basic_category, canonicalDate);

  const { data: inserted, error: insertError } = await supabase
    .from("dataq_evidence")
    .insert(rows)
    .select(
      "id, doc_type, label, context_note, fmcsa_category, required, status, uploaded_at, uploaded_by"
    );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    evidence: inserted ?? [],
    generated: inserted?.length ?? 0,
  });
}
