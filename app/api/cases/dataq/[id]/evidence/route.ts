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

type EvidenceItem = {
  doc_type: string;
  label: string;
  context_note: string;
  fmcsa_category: string;
  required: boolean;
};

type EvidenceRow = EvidenceItem & { case_id: string };

export function buildEvidenceItems(
  basicCategory: string | null,
  canonDate: string,
  inspState: string
): EvidenceItem[] {
  const cat = (basicCategory ?? "").toLowerCase();

  if (cat === "vehicle_maintenance") {
    return [
      {
        doc_type: "eld_record",
        label: "ELD/driver log records",
        fmcsa_category: "Electronic Logging Device (ELD) Records",
        context_note: `Records for ${canonDate} (${inspState})`,
        required: true,
      },
      {
        doc_type: "vehicle_inspection",
        label: "Vehicle maintenance/repair records",
        fmcsa_category: "Vehicle Inspection Records",
        context_note: "Maintenance records relevant to the inspection date",
        required: false,
      },
    ];
  }

  if (cat === "hos_compliance") {
    return [
      {
        doc_type: "eld_record",
        label: "ELD records and driver hours logs",
        fmcsa_category: "Electronic Logging Device (ELD) Records",
        context_note: `Hours of service records for ${canonDate} (${inspState})`,
        required: true,
      },
      {
        doc_type: "driver_log",
        label: "Driver recap/70-hour records",
        fmcsa_category: "Driver Logs",
        context_note: `70-hour period including ${canonDate}`,
        required: false,
      },
    ];
  }

  if (cat === "driver_fitness") {
    return [
      {
        doc_type: "driver_log",
        label: "Driver qualification file",
        fmcsa_category: "Driver Qualification File",
        context_note: `Driver file current as of ${canonDate}`,
        required: true,
      },
      {
        doc_type: "driver_log",
        label: "Medical examiner certificate",
        fmcsa_category: "Medical Certificate",
        context_note: `Valid certificate at time of ${canonDate} (${inspState})`,
        required: false,
      },
    ];
  }

  if (cat === "unsafe_driving") {
    return [
      {
        doc_type: "eld_record",
        label: "ELD location and speed data",
        fmcsa_category: "Electronic Logging Device (ELD) Records",
        context_note: `GPS/speed records for ${canonDate} (${inspState})`,
        required: true,
      },
    ];
  }

  if (cat === "controlled_substance") {
    return [
      {
        doc_type: "driver_log",
        label: "Drug and alcohol test records",
        fmcsa_category: "Drug and Alcohol Testing Records",
        context_note: `Testing records relevant to ${canonDate}`,
        required: true,
      },
    ];
  }

  if (cat === "hazmat_compliance") {
    return [
      {
        doc_type: "bol",
        label: "Hazmat shipping papers and placards",
        fmcsa_category: "Bill of Lading/Shipping Papers",
        context_note: `Hazmat shipment documentation for ${canonDate} (${inspState})`,
        required: true,
      },
    ];
  }

  // Default — null or unrecognized category
  return [
    {
      doc_type: "other",
      label: "Inspection report and supporting documentation",
      fmcsa_category: "Other",
      context_note: `Supporting documentation for ${canonDate} inspection in ${inspState}`,
      required: true,
    },
  ];
}

function buildEvidenceRows(
  caseId: string,
  basicCategory: string | null,
  canonDate: string,
  inspState: string
): EvidenceRow[] {
  return buildEvidenceItems(basicCategory, canonDate, inspState).map(
    (item) => ({ ...item, case_id: caseId })
  );
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
    return NextResponse.json({
      evidence: existing,
      generated: 0,
      alreadyExisted: true,
    });
  }

  // Fetch case with violation + inspection data
  const { data: c, error: caseError } = await supabase
    .from("dataq_cases")
    .select(
      "id, canonical_inspection_date, violations(basic_category), inspections(inspection_date, state)"
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
  ) as { inspection_date: string; state: string | null } | null;

  const canonicalDate: string =
    (c.canonical_inspection_date as string | null) ??
    inspection?.inspection_date ??
    "the inspection date";

  const inspState: string = inspection?.state ?? "inspection state";

  const rows = buildEvidenceRows(
    id,
    violation?.basic_category ?? null,
    canonicalDate,
    inspState
  );

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
