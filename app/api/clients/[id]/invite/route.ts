import { createServiceClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email/client";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", id)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Invalidate any existing unused invites for this email + client
    await supabase
      .from("client_invites")
      .update({ expires_at: new Date().toISOString() })
      .eq("client_id", id)
      .eq("email", email.toLowerCase())
      .is("used_at", null);

    // Create a new invite token (7-day expiry, set by DB default)
    const { data: invite, error: inviteError } = await supabase
      .from("client_invites")
      .insert({
        client_id: id,
        email: email.toLowerCase(),
      })
      .select("token")
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: inviteError?.message ?? "Failed to create invite" },
        { status: 500 }
      );
    }

    // Build the setup URL
    const setupUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/setup?token=${invite.token}`;

    // Send branded invite email
    await sendInviteEmail({
      to: email,
      companyName: client.name,
      magicLinkUrl: setupUrl,
    });

    return NextResponse.json({ success: true, message: `Invite sent to ${email}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
