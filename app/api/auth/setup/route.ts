import { createClient } from "@supabase/supabase-js";
import { sendWelcomeEmail } from "@/lib/email/client";
import { NextResponse } from "next/server";

// GET /api/auth/setup?token=xxx — look up invite to pre-populate setup page
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: invite } = await supabase
    .from("client_invites")
    .select("client_id, email, used_at, expires_at")
    .eq("token", token)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  if (invite.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 410 });
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  const { data: clientRecord } = await supabase
    .from("clients")
    .select("name, primary_contact")
    .eq("id", invite.client_id)
    .single();

  return NextResponse.json({
    companyName: clientRecord?.name ?? null,
    email: invite.email,
    primaryContact: clientRecord?.primary_contact ?? null,
  });
}

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
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName || "",
          },
        }
      );

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      authUserId = existingAuthUser.id;
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: invite.email,
        password,
        email_confirm: true,
        user_metadata: {
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
    const { error: userUpsertError } = await supabase.from("users").upsert(
      {
        id: authUserId,
        email: invite.email.toLowerCase(),
        role: "client_user",
        client_id: invite.client_id,
        full_name: fullName || null,
      },
      { onConflict: "id" }
    );
    if (userUpsertError) {
      return NextResponse.json(
        { error: `Failed to link portal profile: ${userUpsertError.message}` },
        { status: 500 }
      );
    }

    // Mark invite as used
    const { error: inviteUpdateError } = await supabase
      .from("client_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (inviteUpdateError) {
      return NextResponse.json(
        { error: `Failed to complete invite: ${inviteUpdateError.message}` },
        { status: 500 }
      );
    }

    // Send welcome email — non-fatal if it fails
    const { data: clientRecord } = await supabase
      .from("clients")
      .select("name, dot_number")
      .eq("id", invite.client_id)
      .single();

    if (clientRecord) {
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal`;
      await sendWelcomeEmail({
        to: invite.email,
        companyName: clientRecord.name,
        dotNumber: clientRecord.dot_number,
        userFullName: fullName || undefined,
        portalUrl,
      });
    }

    return NextResponse.json({ success: true, email: invite.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
