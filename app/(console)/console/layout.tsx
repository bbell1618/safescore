import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ConsoleSidebar } from "@/components/console/sidebar";

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
    .single();

  if (roleError || !userRecord) {
    throw new Error(
      `Unable to verify console access: ${roleError?.message ?? "profile not found"}`
    );
  }
  if (userRecord.role === "client_user") redirect("/portal");
  if (userRecord.role !== "geia_admin" && userRecord.role !== "geia_staff") {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-[#FEFCF8] overflow-hidden">
      <ConsoleSidebar userEmail={user.email} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
