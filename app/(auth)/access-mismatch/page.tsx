import { redirect } from "next/navigation";
import { SessionCollision } from "@/components/auth/session-collision";
import { createClient } from "@/lib/supabase/server";

export default async function AccessMismatchPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(`Unable to verify the current session: ${error.message}`);
  }
  if (!user) redirect("/login");

  const [{ target }, { data: profile, error: profileError }] = await Promise.all([
    searchParams,
    supabase.from("users").select("role, client_id").eq("id", user.id).maybeSingle(),
  ]);
  if (profileError) throw new Error(`Unable to verify account access: ${profileError.message}`);
  const assigned = profile?.role === "geia_admin" || profile?.role === "geia_staff" ||
    (profile?.role === "client_user" && profile.client_id);
  return <SessionCollision target={!assigned ? "unlinked" : target === "portal" ? "portal" : "console"} />;
}
