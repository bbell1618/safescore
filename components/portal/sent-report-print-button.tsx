"use client";

import { Printer } from "lucide-react";

export function SentReportPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary inline-flex items-center gap-2"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}
