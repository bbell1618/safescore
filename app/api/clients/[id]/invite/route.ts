import { createServiceClient } from "@/lib/supabase/server";
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

    // Check if a user with this email already exists for this client
    const { data: existingUsers } = await supabase
      .from("users")
      .select("id, email")
      .eq("client_id", id);

    const alreadyInvited = existingUsers?.some(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (alreadyInvited) {
      return NextResponse.json(
        { error: "A user with this email already has access to this client account." },
        { status: 409 }
      );
    }

    // Send Supabase invite — triggers magic-link email
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/portal`,
      data: {
        role: "client_user",
        client_id: id,
        full_name: "",
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If trigger didn't fire yet (async), ensure users row is linked to client
    // The handle_new_user trigger creates the row on signup with client_user role,
    // but we need to make sure client_id gets set once the user confirms.
    // We pre-insert a users row so the client_id is ready immediately on confirm.
    await supabase
      .from("users")
      .upsert(
        {
          id: data.user.id,
          email: email.toLowerCase(),
          role: "client_user",
          client_id: id,
        },
        { onConflict: "id" }
      );

    return NextResponse.json({
      success: true,
      message: `Invite sent to ${email}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
