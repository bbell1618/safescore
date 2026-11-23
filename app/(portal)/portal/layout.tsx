import { SessionCollision } from "@/components/auth/session-collision";
import { PortalNav } from "@/components/portal/nav";
import { loadPortalContext } from "@/lib/portal/access";
import { redirect } from "next/navigation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await loadPortalContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status === "unlinked") redirect("/access-mismatch");
  if (context.status === "forbidden") {
    return <SessionCollision target="portal" />;
  }

  const isLinked = context.status === "linked";
  return (
    <div className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark">
      <PortalNav
        userEmail={context.userEmail}
        companyName={isLinked ? context.clientName : undefined}
        tier={isLinked ? context.tier : "assessment"}
      />
      <main className="w-full">{children}</main>
    </div>
  );
}
