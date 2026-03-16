import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PortalNav } from "@/components/portal/nav";

export default async function PortalLayout({
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
  if (role === "geia_admin" || role === "geia_staff") redirect("/console");

  // Fetch user record with client info
  const { data: userRecord } = await supabase
    .from("users")
    .select("*, clients(name)")
    .eq("id", user.id)
    .single();

  const clientName =
    userRecord?.clients && !Array.isArray(userRecord.clients)
      ? (userRecord.clients as { name: string }).name
      : Array.isArray(userRecord?.clients) && userRecord.clients.length > 0
      ? (userRecord.clients as { name: string }[])[0].name
      : undefined;

  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      <PortalNav userEmail={user.email} companyName={clientName} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
