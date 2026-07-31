import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up user record to get client_id
  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) {
    return NextResponse.json({ client: null });
  }

  // Look up client details
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, dot_number, status, tier, email, primary_contact, phone, driver_count, fmcsa_authorized, eld_provider, safety_contact_name, safety_contact_email, standing_authorization, service_agreement_accepted, citation_dismissed_last_24_months")
    .eq("id", userRecord.client_id)
    .single();

  return NextResponse.json({ client: client ?? null });
}
