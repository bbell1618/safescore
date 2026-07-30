"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { tierHasFeature, type TierFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { motion, useReducedMotion } from "framer-motion";
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
    href: "/portal/playbook",
    label: "Playbook",
    feature: "playbook_coach",
  },
  {
    href: "/portal/activity",
    label: "Activity",
    feature: "trend_history",
  },
  {
    href: "/portal/documents",
    label: "Documents",
    feature: "monthly_reports",
  },
  { href: "/portal/account", label: "Account" },
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
          className="h-3 w-3 text-warm-white/55"
          aria-label="Upgrade required"
        />
      )}
    </span>
  );
}

export function PortalNav({ userEmail, companyName, tier }: PortalNavProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const reduceMotion = useReducedMotion();
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
    <header className="portal-navy-texture sticky top-0 z-50 border-b border-gold/15 font-body shadow-[var(--shadow-sm)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <Link
            href="/portal"
            className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
            aria-label="SafeScore home"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber shadow-[var(--shadow-md)]">
              <ShieldCheck className="h-4 w-4 text-navy" />
            </span>
            <span>
              <span className="block font-mono text-[10px] uppercase leading-none tracking-widest text-gold-light">
                Golden Era
              </span>
              <span className="mt-0.5 block font-heading text-base font-semibold leading-tight tracking-tight text-warm-white">
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
                    "group relative px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    active
                      ? "text-gold"
                      : "text-warm-white/80 hover:text-warm-white"
                  )}
                >
                  <NavLabel item={item} tier={tier} />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-3 bottom-0 h-0.5 origin-left bg-gold transition-transform duration-200",
                      active ? "scale-x-0" : "scale-x-0 group-hover:scale-x-100"
                    )}
                  />
                  {active ? (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-x-3 bottom-0 h-0.5 bg-gold"
                      layoutId="portal-active-tab-indicator"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              type: "spring",
                              stiffness: 460,
                              damping: 38,
                            }
                      }
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {companyName && (
              <span className="max-w-40 truncate rounded-full border border-warm-white/15 bg-warm-white/5 px-3 py-1 font-mono text-xs font-medium text-warm-white">
                {companyName}
              </span>
            )}
            {userEmail && (
              <span className="hidden max-w-36 truncate rounded-full border border-warm-white/10 bg-warm-white/5 px-2.5 py-1 text-xs text-warm-white/70 lg:block">
                {userEmail}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-1.5 rounded-md border border-amber/35 bg-amber/10 px-3 py-2 text-sm font-medium text-warm-white transition-colors duration-150 hover:border-amber/60 hover:bg-amber/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5 text-amber-light" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-warm-white/80 transition-colors duration-150 hover:bg-warm-white/10 hover:text-warm-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold md:hidden"
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
            className="space-y-1 border-t border-warm-white/10 py-3 md:hidden"
          >
            {companyName && (
              <div className="px-3 py-2 font-mono text-xs font-medium text-warm-white/65">
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
                      "relative block rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      active
                        ? "bg-warm-white/5 text-gold"
                        : "text-warm-white/80 hover:bg-warm-white/5 hover:text-warm-white"
                    )}
                  >
                    <NavLabel item={item} tier={tier} />
                  </Link>
                );
              })}
            </nav>
            <div className="mt-2 border-t border-warm-white/10 pt-2">
              {userEmail && (
                <p className="truncate px-3 py-1 text-xs text-warm-white/65">
                  {userEmail}
                </p>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-warm-white transition-colors duration-150 hover:bg-amber/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5 text-amber-light" />
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
