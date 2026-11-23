"use client";

import { useEffect, useState } from "react";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";

const LINES = [
  "Pulling up your record",
  "Checking your inspections",
  "Lining up your next steps",
  "Almost there",
];

/** QF-225: the one loading screen for the carrier's account: the truck, centered, and a short line. */
export function PortalLoadingScreen() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLine((n) => Math.min(n + 1, LINES.length - 1)), 1600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="status" className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center px-4 pb-16 text-navy">
      <GoldenEraTruckLoader className="h-28 w-72 sm:h-32 sm:w-80" />
      <h2 className="mt-4 text-xl font-bold">Loading your SafeScore</h2>
      <p className="mt-1 text-sm text-warm-mid" aria-live="polite">{LINES[line]}</p>
    </div>
  );
}
