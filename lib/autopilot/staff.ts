import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Returns the signed-in staff user's id, or null when not staff. */
export async function requireStaffUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "geia_admin" || data?.role === "geia_staff" ? user.id : null;
}
