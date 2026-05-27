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

  let pin: string | undefined;
  let authorized: boolean = false;

  try {
    const body = await request.json();
    pin = body.pin;
    authorized = body.authorized === true;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── All DB operations use the admin client (bypasses RLS) ────────────────────
  const admin = getAdmin();

  // Get user's client_id
  const { data: userRecord, error: userError } = await admin
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (userError) {
    console.error(
      "fmcsa-credentials: user lookup failed:",
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

  const clientId: string = userRecord.client_id;

  // Get client's DOT number
  const { data: clientRecord, error: clientLookupError } = await admin
    .from("clients")
    .select("dot_number")
    .eq("id", clientId)
    .single();

  if (clientLookupError) {
    console.error(
      "fmcsa-credentials: client lookup failed:",
      clientLookupError.code,
      clientLookupError.message,
      clientLookupError.details
    );
  }

  const dotNumber: string | null = clientRecord?.dot_number ?? null;

  // ── Save PIN to client_credentials ──────────────────────────────────────────
  if (pin && pin.trim()) {
    // Encode PIN as hex bytea: \x<hex> is the PostgREST hex literal format.
    // JS "\\x" is the two-char string \x; JSON.stringify escapes the backslash
    // so PostgREST deserializes it back to \x<hex>, which Postgres accepts as bytea.
    const pinHex = "\\x" + Buffer.from(pin.trim(), "utf8").toString("hex");

    const { error: credError } = await admin
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
      console.error(
        "fmcsa-credentials: PIN upsert failed:",
        credError.code,
        credError.message,
        credError.details,
        credError.hint
      );
      return NextResponse.json(
        { success: false, error: "Failed to save credentials" },
        { status: 500 }
      );
    }
  }

  // ── Record FMCSA authorization flag on clients row ───────────────────────────
  if (authorized) {
    const { error: authFlagError } = await admin
      .from("clients")
      .update({
        fmcsa_authorized: true,
        fmcsa_auth_date: new Date().toISOString(),
      })
      .eq("id", clientId);

    if (authFlagError) {
      // Non-fatal — PIN was saved; log but don't 500
      console.error(
        "fmcsa-credentials: auth flag update failed:",
        authFlagError.code,
        authFlagError.message,
        authFlagError.details
      );
    }
  }

  // ── Activity log (non-fatal) ─────────────────────────────────────────────────
  try {
    await admin.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "fmcsa_credentials_submitted",
      description: "Client submitted FMCSA portal credentials",
      metadata: { authorized, pin_provided: !!(pin && pin.trim()) },
    });
  } catch (logErr) {
    console.error("fmcsa-credentials: activity log error (non-fatal):", logErr);
  }

  return NextResponse.json({ success: true });
}
