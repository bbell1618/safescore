import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PortalNav } from "@/components/portal/nav";
import Link from "next/link";
import { normalizeClientTier } from "@/lib/tiers";
import { SessionCollision } from "@/components/auth/session-collision";
import { isClientOnboardingLocked } from "@/lib/auth/access";

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

  // Fetch user record with client info
  const { data: userRecord, error: userRecordError } = await supabase
    .from("users")
    .select(
      "role, client_id, clients(name, fmcsa_authorized, tier, status, service_agreement_accepted)"
    )
    .eq("id", user.id)
    .single();

  if (userRecordError) {
    throw new Error(`Unable to load portal account: ${userRecordError.message}`);
  }
  if (userRecord?.role === "geia_admin" || userRecord?.role === "geia_staff") {
    return <SessionCollision target="portal" />;
  }

  const clientName =
    userRecord?.clients && !Array.isArray(userRecord.clients)
      ? (userRecord.clients as { name: string }).name
      : Array.isArray(userRecord?.clients) && userRecord.clients.length > 0
      ? (userRecord.clients as { name: string }[])[0].name
      : undefined;
  const clientRelation = Array.isArray(userRecord?.clients) ? userRecord.clients[0] : userRecord?.clients;
  const fmcsaAuthorized = (clientRelation as { fmcsa_authorized?: boolean } | null)?.fmcsa_authorized === true;
  const onboardingLocked = clientRelation
      ? isClientOnboardingLocked(
        clientRelation as {
          status: string | null;
          service_agreement_accepted?: boolean | null;
        }
      )
    : false;
  const tier = normalizeClientTier(
    (clientRelation as { tier?: string | null } | null)?.tier
  );

  return (
    <div className="min-h-screen bg-[#FEFCF8]">
      <PortalNav userEmail={user.email} companyName={clientName} tier={tier} />
      {!fmcsaAuthorized && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          FMCSA access is incomplete.{" "}
          {onboardingLocked ? (
            <span>Contact your GEIA representative to complete access.</span>
          ) : (
            <Link className="font-semibold underline" href="/onboarding">
              Complete FMCSA access
            </Link>
          )}
        </div>
      )}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
