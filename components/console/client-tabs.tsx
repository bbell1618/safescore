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
  { key: "overview", label: "Overview", href: "" },
  { key: "violations", label: "Violations", href: "/violations" },
  { key: "remediation", label: "Remediation", href: "/remediation", feature: "playbook_coach" },
  { key: "cases", label: "Cases", href: "/cases", feature: "case_visibility" },
  { key: "requests", label: "Requests", href: "/requests", feature: "evidence_requests" },
  { key: "monitoring", label: "Monitoring", href: "/monitoring", feature: "monitoring_alerts" },
  { key: "compliance", label: "Compliance", href: "/compliance", feature: "compliance_layer" },
  { key: "reports", label: "Reports", href: "/reports", feature: "monthly_reports" },
  { key: "account", label: "Account", href: "/account" },
];

function activeTab(pathname: string) {
  if (pathname.includes("/cases") || pathname.includes("/dataq") || pathname.includes("/cpdp")) {
    return "cases";
  }
  if (pathname.includes("/violations")) return "violations";
  if (pathname.includes("/remediation")) return "remediation";
  if (pathname.includes("/requests")) return "requests";
  if (pathname.includes("/monitoring")) return "monitoring";
  if (pathname.includes("/compliance")) return "compliance";
  if (pathname.includes("/reports")) return "reports";
  if (pathname.includes("/account")) return "account";
  return "overview";
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
