import type { Metadata } from "next";
import { RosterWizard } from "@/components/roster/roster-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Driver list | Golden Era SafeScore",
  description: "Securely share your driver list and credential photos with Golden Era SafeScore.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RosterCollectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark">
      <header className="portal-navy-texture border-b border-gold/20 text-warm-white shadow-md">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold/35 bg-warm-white/5 font-heading text-sm font-bold text-gold-light">
            SS
          </span>
          <div>
            <p className="font-heading text-base font-semibold text-warm-white">Golden Era SafeScore</p>
            <p className="text-xs text-warm-white/70">Secure driver-list collection</p>
          </div>
          <span className="ml-auto hidden rounded-full border border-warm-white/15 bg-warm-white/5 px-3 py-1.5 text-xs text-warm-white/75 sm:inline-flex">
            No login needed
          </span>
        </div>
      </header>
      <RosterWizard token={token} />
      <footer className="portal-navy-texture mt-10 border-t border-gold/15 text-warm-white">
        <div className="mx-auto max-w-7xl px-4 py-6 text-center text-xs leading-5 text-warm-white/70 sm:px-6">
          Golden Era Insurance Agency · Your documents are sent through a secure, private link.
        </div>
      </footer>
    </main>
  );
}
