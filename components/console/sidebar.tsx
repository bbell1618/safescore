"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutList,
  Search,
  Users,
  Activity,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/console", label: "Today", icon: LayoutList, exact: true },
  { href: "/console/clients", label: "Clients", icon: Users },
  { href: "/console/assess", label: "Assess", icon: Search },
  { href: "/console/activity", label: "Activity", icon: Activity },
];

interface SidebarProps {
  userEmail?: string;
}

export function ConsoleSidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const supabase = createClient();
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
    <aside className="flex w-full shrink-0 flex-col bg-navy md:sticky md:top-0 md:h-dvh md:w-56">
      {/* Logo */}
      <div className="hidden border-b border-white/10 px-5 py-5 md:block">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[#C67A1E] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest leading-none">
              Golden Era
            </p>
            <p
              className="text-white font-bold text-sm leading-tight"
            >
              SafeScore
            </p>
          </div>
        </div>
        <div className="mt-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#C67A1E]/20 text-[#C67A1E]">
          Console
        </div>
      </div>

      {/* Nav */}
      <details className="border-b border-white/10 px-4 text-white md:hidden">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">SafeScore · Console account</summary>
        <p className="break-all text-xs text-white/70">{userEmail}</p>
        <button onClick={handleSignOut} disabled={signingOut} className="min-h-11 py-2 text-sm">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError ? <p role="alert" className="pb-3 text-xs text-red-200">{signOutError}</p> : null}
      </details>
      <nav aria-label="Console navigation" className="grid grid-cols-4 gap-0.5 px-2 py-1 md:flex md:flex-1 md:flex-col md:overflow-y-auto md:px-3 md:py-4">
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
                "flex min-h-11 items-center justify-center gap-1.5 border-b-2 px-1 py-2 text-sm transition-colors md:justify-start md:gap-2.5 md:border-b-0 md:border-l-2 md:px-3",
                active
                  ? "border-gold text-white font-medium"
                  : "border-transparent text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="hidden border-t border-white/10 px-3 py-4 md:block">
        {userEmail && (
          <p className="text-white/40 text-xs px-3 mb-2 truncate">{userEmail}</p>
        )}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError && (
          <p role="alert" className="mt-2 px-3 text-xs leading-5 text-red-200">
            {signOutError}
          </p>
        )}
      </div>
    </aside>
  );
}
