import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ConsoleSidebar } from "@/components/console/sidebar";
import { SessionCollision } from "@/components/auth/session-collision";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRecord, error: roleError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (roleError) {
    throw new Error(
      `Unable to verify console access: ${roleError?.message ?? "profile not found"}`
    );
  }
  if (!userRecord) redirect("/access-mismatch");
  if (userRecord.role === "client_user") {
    return <SessionCollision target="console" />;
  }
  if (userRecord.role !== "geia_admin" && userRecord.role !== "geia_staff") {
    redirect("/access-mismatch");
  }

  return (
    <div className="portal-brand-root portal-warm-texture flex h-screen overflow-hidden">
      <ConsoleSidebar userEmail={user.email} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
