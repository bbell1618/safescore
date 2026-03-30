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

    // Check if auth user already exists
    const { data: userList } = await supabase.auth.admin.listUsers();
    const existingAuthUser = userList?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let authUserId: string;

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;
      // Ensure email is confirmed so magic links work
      if (!existingAuthUser.email_confirmed_at) {
        await supabase.auth.admin.updateUser(existingAuthUser.id, {
          email_confirm: true,
        });
      }
    } else {
      // Create new auth user with confirmed email so magic links work
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          role: "client_user",
          client_id: id,
          full_name: "",
        },
      });

      if (createError || !newUser.user) {
        return NextResponse.json(
          { error: createError?.message ?? "Failed to create user" },
          { status: 500 }
        );
      }

      authUserId = newUser.user.id;
    }

    // Ensure users table row exists with correct client_id
    await supabase.from("users").upsert(
      {
        id: authUserId,
        email: email.toLowerCase(),
        role: "client_user",
        client_id: id,
      },
      { onConflict: "id" }
    );

    // Generate magic link (user is confirmed, so magiclink type always works)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json(
        { error: linkError?.message ?? "Failed to generate invite link" },
        { status: 500 }
      );
    }

    // Send branded invite email
    await sendInviteEmail({
      to: email,
      companyName: client.name,
      magicLinkUrl: linkData.properties.action_link,
    });

    const message = existingAuthUser
      ? `Invite resent to ${email}`
      : `Invite sent to ${email}`;
    return NextResponse.json({ success: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
