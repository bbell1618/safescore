"use client";

import { Printer } from "lucide-react";

export function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-[#1B2D4F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2A4270]"
    >
      <Printer className="h-4 w-4" />
      Print / Save PDF
    </button>
  );
}
