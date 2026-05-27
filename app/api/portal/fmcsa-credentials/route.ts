import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  // Use anon client for auth/session check (needs cookies)
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

  // Get user's client_id (users_self SELECT policy allows this)
  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single() as any;

  if (!userRecord?.client_id) {
    return NextResponse.json(
      { error: "No client associated with this account" },
      { status: 400 }
    );
  }

  const clientId: string = userRecord.client_id;

  // All writes below require the service role to bypass RLS.
  // client_credentials has geia_staff_only policy; clients UPDATE also requires staff.
  const serviceSupabase = await createServiceClient();

  // Get client's DOT number for fmcsa_dot_number field
  const { data: clientRecord } = await serviceSupabase
    .from("clients")
    .select("dot_number")
    .eq("id", clientId)
    .single() as any;

  const dotNumber: string | null = clientRecord?.dot_number ?? null;

  // ── Save PIN to client_credentials ──────────────────────────────────────────
  if (pin && pin.trim()) {
    // Encode PIN as hex bytea for PostgreSQL: PostgREST hex format \x<hex>
    // In JS `'\\x'` is the two-char string `\x`; PostgREST treats \x<hex> as bytea hex literal
    const pinHex = "\\x" + Buffer.from(pin.trim(), "utf8").toString("hex");

    const { error: credError } = await serviceSupabase
      .from("client_credentials")
      .upsert(
        {
          client_id: clientId,
          fmcsa_dot_number: dotNumber,
          fmcsa_pin_encrypted: pinHex,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" }
      );

    if (credError) {
      console.error("FMCSA PIN save to client_credentials failed:", credError.message);
      return NextResponse.json(
        { success: false, error: "Failed to save credentials" },
        { status: 500 }
      );
    }
  }

  // ── Record FMCSA authorization flag on clients row ───────────────────────────
  if (authorized) {
    await serviceSupabase
      .from("clients")
      .update({
        fmcsa_authorized: true,
        fmcsa_auth_date: new Date().toISOString(),
      })
      .eq("id", clientId);
  }

  // ── Activity log (non-fatal) ─────────────────────────────────────────────────
  try {
    await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "fmcsa_credentials_submitted",
      description: "Client submitted FMCSA portal credentials",
      metadata: { authorized, pin_provided: !!(pin && pin.trim()) },
    });
  } catch (logErr) {
    console.error("Activity log error (non-fatal):", logErr);
  }

  return NextResponse.json({ success: true });
}
