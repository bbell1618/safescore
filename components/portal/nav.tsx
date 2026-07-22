"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ShieldCheck, LogOut, Menu, X, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { tierHasFeature, type TierFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

const navItems: Array<{
  href: string;
  label: string;
  exact?: boolean;
  feature?: TierFeature;
}> = [
  { href: "/portal", label: "Dashboard", exact: true },
  { href: "/portal/safety", label: "Safety profile" },
  { href: "/portal/monitoring", label: "Monitoring", feature: "trend_history" },
  { href: "/portal/reports", label: "Reports", feature: "monthly_reports" },
  { href: "/portal/cases", label: "Cases", feature: "case_visibility" },
  { href: "/portal/requests", label: "Requests", feature: "evidence_requests" },
  { href: "/portal/plan", label: "Playbook", feature: "playbook_coach" },
  { href: "/portal/documents", label: "Documents", feature: "compliance_layer" },
  { href: "/portal/compliance", label: "Compliance", feature: "compliance_layer" },
  { href: "/portal/profile", label: "Settings" },
];

interface PortalNavProps {
  userEmail?: string;
  companyName?: string;
  tier: ClientTier;
}

export function PortalNav({ userEmail, companyName, tier }: PortalNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="bg-white border-b border-[#F0E8DA] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Left: Logo + SafeScore */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-md bg-[#C67A1E] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest leading-none">
                Golden Era
              </p>
              <p
                className="text-[#1E1C1A] font-bold text-sm leading-tight"
              >
                SafeScore
              </p>
            </div>
          </div>

          {/* Center: Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-[#FEFCF8] text-[#1E1C1A]"
                      : "text-gray-500 hover:text-[#1E1C1A] hover:bg-[#FBF7F0]"
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {item.label}
                    {item.feature && !tierHasFeature(tier, item.feature) && (
                      <LockKeyhole className="h-3 w-3 text-gray-400" aria-label="Upgrade required" />
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Right: Company chip + Sign out (desktop) */}
          <div className="hidden md:flex items-center gap-3">
            {companyName && (
              <span className="px-2.5 py-1 bg-[#FEFCF8] rounded-full text-xs font-medium text-[#1E1C1A] max-w-[160px] truncate">
                {companyName}
              </span>
            )}
            {userEmail && (
              <span className="text-xs text-gray-400 max-w-[140px] truncate hidden lg:block">
                {userEmail}
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-[#1E1C1A] hover:bg-[#FBF7F0] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>

          {/* Mobile: hamburger */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-[#FBF7F0] transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#F0E8DA] py-3 space-y-1">
            {companyName && (
              <div className="px-3 py-2 text-xs font-medium text-gray-500">
                {companyName}
              </div>
            )}
            {navItems.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "block px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-[#FEFCF8] text-[#1E1C1A]"
                      : "text-gray-500 hover:text-[#1E1C1A] hover:bg-[#FBF7F0]"
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {item.label}
                    {item.feature && !tierHasFeature(tier, item.feature) && (
                      <LockKeyhole className="h-3 w-3 text-gray-400" aria-label="Upgrade required" />
                    )}
                  </span>
                </Link>
              );
            })}
            <div className="border-t border-[#F0E8DA] pt-2 mt-2">
              {userEmail && (
                <p className="px-3 py-1 text-xs text-gray-400 truncate">{userEmail}</p>
              )}
              <button
                onClick={handleSignOut}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-[#1E1C1A] hover:bg-[#FBF7F0] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
