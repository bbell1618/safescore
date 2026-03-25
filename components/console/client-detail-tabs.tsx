"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Violations", slug: "violations" },
  { label: "Crashes", slug: "cpdp" },
  { label: "DataQs cases", slug: "dataq" },
  { label: "Compliance", slug: "compliance" },
  { label: "Reports", slug: "reports" },
];

interface ClientDetailTabsProps {
  clientId: string;
  dotNumber: string;
}

export function ClientDetailTabs({ clientId, dotNumber }: ClientDetailTabsProps) {
  const pathname = usePathname();

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-[#E5E5E5] px-1 overflow-x-auto">
        {tabs.map((tab) => {
          const href = `/console/clients/${clientId}/${tab.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.slug}
              href={href}
              className={cn(
                "px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                active
                  ? "border-[#DC362E] text-[#DC362E]"
                  : "border-transparent text-gray-500 hover:text-[#1A1A1A]"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="p-5 text-sm text-gray-400 text-center py-8">
        Select a tab above to view details.
      </div>
    </div>
  );
}
