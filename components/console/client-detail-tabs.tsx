"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Violations", slug: "violations" },
  { label: "Crashes", slug: "cpdp" },
  { label: "DataQ cases", slug: "dataq" },
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
    <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-[#F0E8DA] px-1 overflow-x-auto">
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
                  ? "border-[#C67A1E] text-[#C67A1E]"
                  : "border-transparent text-gray-500 hover:text-[#1E1C1A]"
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
