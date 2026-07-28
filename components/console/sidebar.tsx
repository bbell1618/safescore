"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Users,
  Activity,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/console", label: "Clients", icon: Users, exact: true },
  { href: "/console/activity", label: "Activity log", icon: Activity },
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
    <aside className="w-56 shrink-0 bg-[#1B2D4F] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
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
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10">
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
