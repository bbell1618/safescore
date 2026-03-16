import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up user record to get client_id
  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single() as any;

  if (!userRecord?.client_id) {
    return NextResponse.json({ client: null });
  }

  // Look up client details
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, dot_number, status")
    .eq("id", userRecord.client_id)
    .single() as any;

  return NextResponse.json({ client: client ?? null });
}
