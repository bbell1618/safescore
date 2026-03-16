"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Users,
  LayoutDashboard,
  Activity,
  LogOut,
  ShieldCheck,
} from "lucide-react";

const navItems = [
  { href: "/console", label: "Clients", icon: Users, exact: true },
  { href: "/console/activity", label: "Activity log", icon: Activity },
];

interface SidebarProps {
  userEmail?: string;
}

export function ConsoleSidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-56 shrink-0 bg-[#222222] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[#DC362E] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest leading-none">
              Golden Era
            </p>
            <p
              className="text-white font-bold text-sm leading-tight"
              style={{ fontFamily: "var(--font-montserrat)" }}
            >
              SafeScore
            </p>
          </div>
        </div>
        <div className="mt-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#DC362E]/20 text-[#DC362E]">
          GEIA Console
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
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
