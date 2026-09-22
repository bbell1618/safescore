"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import type { ClientTier } from "@/lib/supabase/types";
import type { TierFeature } from "@/lib/tiers";

const TABS: ReadonlyArray<{
  key: string;
  label: string;
  href: string;
  feature?: TierFeature;
}> = [
  { key: "work", label: "Work", href: "/work" },
  { key: "profile", label: "Profile", href: "" },
  { key: "violations", label: "Violations", href: "/violations" },
  { key: "cases", label: "Cases", href: "/cases", feature: "case_visibility" },
  { key: "plan", label: "Plan", href: "/plan", feature: "playbook_coach" },
  { key: "account", label: "Account", href: "/account" },
];

function activeTab(pathname: string) {
  const section = pathname.split("/")[4] ?? "";
  if (["work", "checklist", "requests", "monitoring"].includes(section)) return "work";
  if (["cases", "dataq", "cpdp"].includes(section)) return "cases";
  if (["plan", "remediation", "compliance"].includes(section)) return "plan";
  if (["account", "reports"].includes(section)) return "account";
  if (section === "violations") return "violations";
  return "profile";
}

export function ClientTabs({ clientId, tier }: { clientId: string; tier: ClientTier }) {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const base = `/console/clients/${clientId}`;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-[#F0E8DA]" aria-label="Client file tabs">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`${base}${tab.href}`}
          className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
            active === tab.key
              ? "border-[#C67A1E] text-[#1E1C1A]"
              : "border-transparent text-gray-500 hover:text-[#C67A1E]"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.feature && <ServiceTierChip tier={tier} feature={tab.feature} compact />}
          </span>
        </Link>
      ))}
    </nav>
  );
}
