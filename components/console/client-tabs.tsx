"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "overview", label: "Overview", href: "" },
  { key: "violations", label: "Violations", href: "/violations" },
  { key: "remediation", label: "Remediation", href: "/remediation" },
  { key: "cases", label: "Cases", href: "/cases" },
  { key: "requests", label: "Requests", href: "/requests" },
  { key: "monitoring", label: "Monitoring", href: "/monitoring" },
  { key: "compliance", label: "Compliance", href: "/compliance" },
  { key: "reports", label: "Reports", href: "/reports" },
  { key: "account", label: "Account", href: "/account" },
] as const;

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

export function ClientTabs({ clientId }: { clientId: string }) {
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
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
