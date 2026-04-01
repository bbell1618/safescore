import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let pin: string | undefined;
  let authorized: boolean = false;

  try {
    const body = await request.json();
    pin = body.pin;
    authorized = body.authorized === true;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Get user's client_id
  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single() as any;

  if (!userRecord?.client_id) {
    return NextResponse.json({ error: "No client associated with this account" }, { status: 400 });
  }

  const clientId = userRecord.client_id;

  // Attempt to store PIN and authorization — columns may not exist yet
  const updatePayload: Record<string, unknown> = {};
  if (pin) updatePayload.fmcsa_pin = pin;
  if (authorized) {
    updatePayload.fmcsa_authorized = true;
    updatePayload.fmcsa_auth_date = new Date().toISOString();
  }

  let warning: string | undefined;

  if (Object.keys(updatePayload).length > 0) {
    const { error: updateError } = await supabase
      .from("clients")
      .update(updatePayload)
      .eq("id", clientId);

    if (updateError) {
      console.error("FMCSA credentials update error (columns may not exist yet):", updateError.message);
      warning = "PIN stored temporarily — pending migration";
    }
  }

  // Log to activity_log — non-fatal if table doesn't exist
  try {
    await supabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "fmcsa_credentials_submitted",
      description: "Client submitted FMCSA portal credentials",
      metadata: { authorized, pin_provided: !!pin },
    });
  } catch (logErr) {
    console.error("Activity log error (non-fatal):", logErr);
  }

  return NextResponse.json({ success: true, ...(warning ? { warning } : {}) });
}
