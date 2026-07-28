import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isClientOnboardingLocked } from "@/lib/auth/access";

// Direct service-role client — no SSR cookie layer, definitively bypasses RLS.
function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  // ── Auth check (uses portal user's session cookie) ───────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── All DB operations use the admin client (bypasses RLS) ────────────────────
  const admin = getAdmin();

  const { data: userRecord, error: userError } = await admin
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (userError) {
    console.error(
      "onboarding-profile: user lookup failed:",
      userError.code,
      userError.message,
      userError.details
    );
    return NextResponse.json({ error: "User lookup failed" }, { status: 500 });
  }

  if (!userRecord?.client_id) {
    return NextResponse.json(
      { error: "No client associated with this account" },
      { status: 400 }
    );
  }

  const clientId = userRecord.client_id;

  const { data: clientRecord, error: clientError } = await admin
    .from("clients")
    .select(
      "primary_contact, primary_contact_title, status, service_agreement_accepted"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !clientRecord) {
    console.error(
      "onboarding-profile: client lookup failed:",
      clientError?.code,
      clientError?.message,
      clientError?.details
    );
    return NextResponse.json(
      { error: clientError?.message ?? "Client lookup failed" },
      { status: 500 }
    );
  }

  if (isClientOnboardingLocked(clientRecord)) {
    return NextResponse.json(
      {
        error:
          "Onboarding is already complete for this carrier. Live client data cannot be changed through onboarding.",
        code: "ONBOARDING_LOCKED",
      },
      { status: 409 }
    );
  }

  // Build update — only include fields that are present in the request body.
  // Columns added by migration: primary_contact_title, vehicle_types,
  // operating_states, operating_radius, service_agreement_accepted,
  // service_agreement_date.
  const update: Record<string, unknown> = {};

  if (body.contactName)    update.primary_contact       = body.contactName;
  if (body.contactTitle)   update.primary_contact_title = body.contactTitle;
  if (body.contactPhone)   update.phone                 = body.contactPhone;
  if (body.contactEmail)   update.email                 = body.contactEmail;

  if (Array.isArray(body.vehicleTypes) && body.vehicleTypes.length > 0) {
    update.vehicle_types = body.vehicleTypes;
  }
  if (Array.isArray(body.operatingStates) && body.operatingStates.length > 0) {
    update.operating_states = body.operatingStates;
  }
  if (body.operatingRadius) update.operating_radius = body.operatingRadius;
  if (typeof body.eldProvider === "string") update.eld_provider = body.eldProvider.trim() || null;
  if (typeof body.safetyContactName === "string") update.safety_contact_name = body.safetyContactName.trim() || null;
  if (typeof body.safetyContactEmail === "string") update.safety_contact_email = body.safetyContactEmail.trim() || null;
  if (typeof body.driverCount === "number" && Number.isInteger(body.driverCount) && body.driverCount >= 0 && body.driverCount <= 10000) {
    update.driver_count = body.driverCount;
  }

  if (body.serviceAgreementAccepted === true) {
    update.service_agreement_accepted = true;
    update.service_agreement_date     = new Date().toISOString();
  }

  if (body.filingAuthorized === true) {
    const providedSigner =
      typeof body.filingAuthorizedBy === "string"
        ? body.filingAuthorizedBy.trim()
        : "";
    const primaryContact =
      typeof clientRecord?.primary_contact === "string"
        ? clientRecord.primary_contact.trim()
        : "";
    const primaryTitle =
      typeof clientRecord?.primary_contact_title === "string"
        ? clientRecord.primary_contact_title.trim()
        : "";

    update.filing_authorized = true;
    update.filing_authorized_at = new Date().toISOString();
    update.filing_authorized_by =
      providedSigner ||
      [primaryContact, primaryTitle].filter(Boolean).join(", ") ||
      null;
    update.filing_authorization_scope =
      "DataQs Requests for Data Review and Crash Preventability Determination (CPDP) requests filed by GEIA on the carrier behalf";
  }
  if (body.standingAuthorization === true) {
    update.standing_authorization = true;
    update.standing_authorized_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true, skipped: true });
  }

  const { error: updateError } = await admin
    .from("clients")
    .update(update)
    .eq("id", clientId);

  if (updateError) {
    console.error(
      "onboarding-profile: clients update failed:",
      updateError.code,
      updateError.message,
      updateError.details,
      updateError.hint
    );
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── Activity log (non-fatal) ─────────────────────────────────────────────────
  try {
    await admin.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "onboarding_profile_saved",
      description: "Client completed onboarding profile step",
      metadata: {
        fields_saved: Object.keys(update),
        vehicle_types: body.vehicleTypes,
        operating_states: body.operatingStates,
        operating_radius: body.operatingRadius,
      },
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true });
}
