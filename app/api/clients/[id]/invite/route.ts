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

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/portal`;

    // Check if a user with this email already exists for this client
    const { data: existingUsers } = await supabase
      .from("users")
      .select("id, email")
      .eq("client_id", id);

    const existingUser = existingUsers?.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );

    let authUserId: string;
    let linkType: "magiclink" | "invite";

    if (existingUser) {
      // User already exists -- generate a new magic link and resend
      authUserId = existingUser.id;
      linkType = "magiclink";
    } else {
      // New user -- create auth account first
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: {
          role: "client_user",
          client_id: id,
          full_name: "",
        },
      });

      if (createError || !newUser.user) {
        return NextResponse.json({ error: createError?.message ?? "Failed to create user" }, { status: 500 });
      }

      authUserId = newUser.user.id;
      linkType = "invite";

      // Pre-insert users row so client_id is ready on confirm
      await supabase
        .from("users")
        .upsert(
          {
            id: authUserId,
            email: email.toLowerCase(),
            role: "client_user",
            client_id: id,
          },
          { onConflict: "id" }
        );
    }

    // Generate magic link without sending Supabase email
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: linkType,
      email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json({ error: linkError?.message ?? "Failed to generate invite link" }, { status: 500 });
    }

    // Send branded invite email via nodemailer
    await sendInviteEmail({
      to: email,
      companyName: client.name,
      magicLinkUrl: linkData.properties.action_link,
    });

    const message = existingUser ? `Invite resent to ${email}` : `Invite sent to ${email}`;
    return NextResponse.json({ success: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
