"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CaseTabsProps {
  dataqCount: number;
  cpdpCount: number;
  dataqContent: ReactNode;
  cpdpContent: ReactNode;
}

export function CaseTabs({
  dataqCount,
  cpdpCount,
  dataqContent,
  cpdpContent,
}: CaseTabsProps) {
  const [activeTab, setActiveTab] = useState<"dataq" | "cpdp">("dataq");

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-white border border-[#E5E5E5] rounded-xl p-1 w-fit">
        {(
          [
            { id: "dataq", label: "DataQs", count: dataqCount },
            { id: "cpdp", label: "CPDP", count: cpdpCount },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
              activeTab === tab.id
                ? "bg-[#F4F4F4] text-[#1A1A1A]"
                : "text-gray-500 hover:text-[#1A1A1A]"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "px-1.5 py-0.5 rounded-full text-xs",
                activeTab === tab.id
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "dataq" ? dataqContent : cpdpContent}
    </div>
  );
}
