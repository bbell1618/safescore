import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { token, password, fullName } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Look up the invite token
    const { data: invite, error: inviteError } = await supabase
      .from("client_invites")
      .select("id, client_id, email, expires_at, used_at")
      .eq("token", token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: "Invalid invite link. Please contact your GEIA representative for a new one." },
        { status: 400 }
      );
    }

    if (invite.used_at) {
      return NextResponse.json(
        { error: "This invite link has already been used. If you already have an account, sign in at the login page." },
        { status: 400 }
      );
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This invite link has expired. Please contact your GEIA representative for a new one." },
        { status: 400 }
      );
    }

    // Check if a Supabase Auth user already exists with this email
    const { data: userList } = await supabase.auth.admin.listUsers();
    const existingAuthUser = userList?.users?.find(
      (u) => u.email?.toLowerCase() === invite.email.toLowerCase()
    );

    let authUserId: string;

    if (existingAuthUser) {
      // Update existing user with new password and confirmed email
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            role: "client_user",
            client_id: invite.client_id,
            full_name: fullName || "",
          },
        }
      );

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      authUserId = existingAuthUser.id;
    } else {
      // Create new auth user with the password they chose
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: invite.email,
        password,
        email_confirm: true,
        user_metadata: {
          role: "client_user",
          client_id: invite.client_id,
          full_name: fullName || "",
        },
      });

      if (createError || !newUser.user) {
        return NextResponse.json(
          { error: createError?.message ?? "Failed to create account" },
          { status: 500 }
        );
      }

      authUserId = newUser.user.id;
    }

    // Ensure users table row exists with correct client_id
    await supabase.from("users").upsert(
      {
        id: authUserId,
        email: invite.email.toLowerCase(),
        role: "client_user",
        client_id: invite.client_id,
        full_name: fullName || null,
      },
      { onConflict: "id" }
    );

    // Mark invite as used
    await supabase
      .from("client_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id);

    return NextResponse.json({ success: true, email: invite.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
