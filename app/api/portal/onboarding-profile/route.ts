import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single() as any;

  if (!userRecord?.client_id) {
    return NextResponse.json({ error: "No client associated with this account" }, { status: 400 });
  }

  const clientId = userRecord.client_id;

  const update: Record<string, unknown> = {};

  if (body.contactName)  update.primary_contact = body.contactName;
  if (body.contactTitle) update.primary_contact_title = body.contactTitle;
  if (body.contactPhone) update.phone = body.contactPhone;
  if (body.contactEmail) update.email = body.contactEmail;
  if (Array.isArray(body.vehicleTypes))   update.vehicle_types = body.vehicleTypes;
  if (Array.isArray(body.operatingStates)) update.operating_states = body.operatingStates;
  if (body.operatingRadius) update.operating_radius = body.operatingRadius;
  if (body.serviceAgreementAccepted === true) {
    update.service_agreement_accepted = true;
    update.service_agreement_date = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true, skipped: true });
  }

  const { error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", clientId);

  if (error) {
    console.error("onboarding-profile update error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await supabase.from("activity_log").insert({
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
