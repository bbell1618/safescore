import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PortalNav } from "@/components/portal/nav";
import Link from "next/link";

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
    .select("*, clients(name, fmcsa_authorized)")
    .eq("id", user.id)
    .single();

  const clientName =
    userRecord?.clients && !Array.isArray(userRecord.clients)
      ? (userRecord.clients as { name: string }).name
      : Array.isArray(userRecord?.clients) && userRecord.clients.length > 0
      ? (userRecord.clients as { name: string }[])[0].name
      : undefined;
  const clientRelation = Array.isArray(userRecord?.clients) ? userRecord.clients[0] : userRecord?.clients;
  const fmcsaAuthorized = (clientRelation as { fmcsa_authorized?: boolean } | null)?.fmcsa_authorized === true;

  return (
    <div className="min-h-screen bg-[#FEFCF8]">
      <PortalNav userEmail={user.email} companyName={clientName} />
      {!fmcsaAuthorized && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          FMCSA access is incomplete. <Link className="font-semibold underline" href="/onboarding">Complete FMCSA access</Link>
        </div>
      )}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
