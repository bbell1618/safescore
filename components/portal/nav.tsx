"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { tierHasFeature, type TierFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { LockKeyhole, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navItems: Array<{
  href: string;
  label: string;
  exact?: boolean;
  feature?: TierFeature;
}> = [
  { href: "/portal", label: "Home", exact: true },
  {
    href: "/portal/plan",
    label: "Playbook",
    feature: "playbook_coach",
  },
  {
    href: "/portal/monitoring",
    label: "Activity",
    feature: "trend_history",
  },
  {
    href: "/portal/documents",
    label: "Documents",
    feature: "compliance_layer",
  },
  { href: "/portal/profile", label: "Account" },
];

interface PortalNavProps {
  userEmail?: string;
  companyName?: string;
  tier: ClientTier;
}

function NavLabel({
  item,
  tier,
}: {
  item: (typeof navItems)[number];
  tier: ClientTier;
}) {
  const locked = item.feature && !tierHasFeature(tier, item.feature);

  return (
    <span className="inline-flex items-center gap-1.5">
      {item.label}
      {locked && (
        <LockKeyhole
          className="h-3 w-3 text-warm-gray"
          aria-label="Upgrade required"
        />
      )}
    </span>
  );
}

export function PortalNav({ userEmail, companyName, tier }: PortalNavProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      setSignOutError(`Unable to sign out: ${error.message}`);
      setSigningOut(false);
      return;
    }
    window.location.replace("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-sand bg-warm-white shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <Link
            href="/portal"
            className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
            aria-label="SafeScore home"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber shadow-sm">
              <ShieldCheck className="h-4 w-4 text-warm-white" />
            </span>
            <span>
              <span className="block font-mono text-[10px] uppercase leading-none tracking-widest text-warm-gray">
                Golden Era
              </span>
              <span className="mt-0.5 block font-heading text-base font-semibold leading-tight tracking-tight text-warm-dark">
                SafeScore
              </span>
            </span>
          </Link>

          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="Portal"
          >
            {navItems.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    active
                      ? "bg-amber-subtle text-amber-hover"
                      : "text-warm-mid hover:bg-cream hover:text-warm-dark"
                  )}
                >
                  <NavLabel item={item} tier={tier} />
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {companyName && (
              <span className="max-w-40 truncate rounded-full border border-sand bg-cream px-3 py-1 font-mono text-xs font-medium text-warm-dark">
                {companyName}
              </span>
            )}
            {userEmail && (
              <span className="hidden max-w-36 truncate text-xs text-warm-gray lg:block">
                {userEmail}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-warm-mid transition-colors duration-150 hover:bg-cream hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-warm-mid transition-colors duration-150 hover:bg-cream hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold md:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle portal menu"
            aria-expanded={mobileOpen}
            aria-controls="portal-mobile-menu"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {mobileOpen && (
          <div
            id="portal-mobile-menu"
            className="space-y-1 border-t border-sand py-3 md:hidden"
          >
            {companyName && (
              <div className="px-3 py-2 font-mono text-xs font-medium text-warm-gray">
                {companyName}
              </div>
            )}
            <nav aria-label="Portal mobile">
              {navItems.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      active
                        ? "bg-amber-subtle text-amber-hover"
                        : "text-warm-mid hover:bg-cream hover:text-warm-dark"
                    )}
                  >
                    <NavLabel item={item} tier={tier} />
                  </Link>
                );
              })}
            </nav>
            <div className="mt-2 border-t border-sand pt-2">
              {userEmail && (
                <p className="truncate px-3 py-1 text-xs text-warm-gray">
                  {userEmail}
                </p>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-warm-mid transition-colors duration-150 hover:bg-cream hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        )}
      </div>
      {signOutError && (
        <div
          role="alert"
          className="border-t border-error/20 bg-error-light px-4 py-2 text-center text-sm text-error"
        >
          {signOutError}
        </div>
      )}
    </header>
  );
}
