"use client";

import { cn } from "@/lib/utils";
import { tierHasFeature, type TierFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { LockKeyhole, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * QF-225 (Brandon, 11/23/2026): the carrier's menu bar.
 * - Always on screen (fixed to the top; the texture class used to override "sticky").
 * - The Golden Era logo, on navy-900 like the website header (Brand v3.1).
 * - No company name or email chips; sign out lives on the Account page.
 * - Active page: white text with a saffron underline (no orange text).
 */

const navItems: Array<{ href: string; label: string; exact?: boolean; feature?: TierFeature; entitledOnly?: boolean }> = [
  { href: "/portal", label: "Home", exact: true },
  { href: "/portal/safety-plan", label: "Safety plan" },
  { href: "/portal/fleet", label: "Drivers and trucks" },
  { href: "/portal/progress", label: "Progress", feature: "trend_history" },
  { href: "/portal/plan", label: "Playbook", feature: "playbook_coach" },
  { href: "/portal/documents", label: "Documents", feature: "monthly_reports" },
  { href: "/portal/account", label: "Account" },
];

interface PortalNavProps {
  tier: ClientTier;
  /** Kept so existing callers compile; no longer shown. */
  userEmail?: string;
  companyName?: string;
}

function isActive(pathname: string, item: (typeof navItems)[number]) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function PortalNav({ tier }: PortalNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navItems.filter((item) => !item.entitledOnly || (item.feature !== undefined && tierHasFeature(tier, item.feature)));

  // Close the phone menu on navigation and on Escape.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0F1B2D] font-body shadow-[0_2px_6px_rgba(15,27,45,0.18)]">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link href="/portal" aria-label="Golden Era Insurance Agency, SafeScore home" className="flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E69634]">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand file, already sized */}
            <img src="/brand/lockup-nav.webp" alt="" width={785} height={176} className="h-9 w-auto lg:h-10" />
            <span aria-hidden className="hidden h-7 w-px bg-white/20 xl:block" />
            <span className="hidden text-[15px] font-semibold text-white xl:block">SafeScore</span>
          </Link>

          <nav aria-label="Portal" className="ml-auto hidden items-center gap-1 lg:flex">
            {items.map((item) => {
              const active = isActive(pathname, item);
              const locked = item.feature && !tierHasFeature(tier, item.feature);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-16 items-center gap-1.5 px-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#E69634]",
                    active ? "text-white" : "text-white/70 hover:text-white"
                  )}
                >
                  {item.label}
                  {locked ? <LockKeyhole className="h-3 w-3 text-white/50" aria-label="Upgrade required" /> : null}
                  <span aria-hidden className={cn("absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-[#E69634] transition-opacity duration-200", active ? "opacity-100" : "opacity-0")} />
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/80 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#E69634] lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="portal-mobile-menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open ? (
          <nav id="portal-mobile-menu" aria-label="Portal" className="max-h-[calc(100svh-4rem)] overflow-y-auto border-t border-white/10 px-4 pb-4 pt-2 lg:hidden">
            {items.map((item) => {
              const active = isActive(pathname, item);
              const locked = item.feature && !tierHasFeature(tier, item.feature);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-2 rounded-lg px-3 text-base font-semibold transition-colors duration-200",
                    active ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span aria-hidden className={cn("h-5 w-[3px] rounded bg-[#E69634]", active ? "opacity-100" : "opacity-0")} />
                  {item.label}
                  {locked ? <LockKeyhole className="h-3.5 w-3.5 text-white/50" aria-label="Upgrade required" /> : null}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>
      {/* Holds the space the fixed bar covers. */}
      <div aria-hidden className="h-16" />
    </>
  );
}
