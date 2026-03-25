import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) return NextResponse.json({ prefs: null });

  // Fetch from a jsonb column on users table or a separate notification_preferences table
  // Stored as user metadata for simplicity since the users table may not have a prefs column yet
  const prefs = user.user_metadata?.notification_prefs ?? null;

  return NextResponse.json({ prefs });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { prefs } = body;

  // Store notification preferences in user metadata
  const { error } = await supabase.auth.updateUser({
    data: { notification_prefs: prefs },
  });

  if (error) {
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
