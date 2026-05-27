import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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

  if (body.serviceAgreementAccepted === true) {
    update.service_agreement_accepted = true;
    update.service_agreement_date     = new Date().toISOString();
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
