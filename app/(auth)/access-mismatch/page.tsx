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

  const { target } = await searchParams;
  return <SessionCollision target={target === "portal" ? "portal" : "console"} />;
}
