import { SessionCollision } from "@/components/auth/session-collision";
import { PortalNav } from "@/components/portal/nav";
import { isClientOnboardingLocked } from "@/lib/auth/access";
import { loadPortalContext } from "@/lib/portal/access";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await loadPortalContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status === "forbidden") {
    return <SessionCollision target="portal" />;
  }

  const isLinked = context.status === "linked";
  const fmcsaAuthorized = isLinked && context.fmcsaAuthorized;
  const onboardingLocked = isLinked
    ? isClientOnboardingLocked({
        status: context.clientStatus,
        service_agreement_accepted: context.serviceAgreementAccepted,
      })
    : false;

  return (
    <div className="min-h-screen bg-cream text-warm-dark">
      <PortalNav
        userEmail={context.userEmail}
        companyName={isLinked ? context.clientName : undefined}
        tier={isLinked ? context.tier : "assessment"}
      />
      {!fmcsaAuthorized && (
        <div className="border-b border-amber/25 bg-amber-subtle px-4 py-2 text-center text-sm text-warm-mid">
          FMCSA access is incomplete.{" "}
          {onboardingLocked ? (
            <span>Contact your GEIA representative to complete access.</span>
          ) : (
            <Link
              className="font-semibold text-amber-dark underline decoration-amber/40 underline-offset-2 transition-colors duration-150 hover:text-amber-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              href="/onboarding"
            >
              Complete FMCSA access
            </Link>
          )}
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
