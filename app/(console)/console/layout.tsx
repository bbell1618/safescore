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

  const role = user.user_metadata?.role as string | undefined;
  if (role === "client_user") redirect("/portal");

  return (
    <div className="flex h-screen bg-[#F4F4F4] overflow-hidden">
      <ConsoleSidebar userEmail={user.email} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
