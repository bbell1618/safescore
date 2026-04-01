"use client";

import { ShieldCheck, ShieldAlert } from "lucide-react";

interface Props {
  hasAccess: boolean;
}

export function FmcsaAccessBadge({ hasAccess }: Props) {
  if (hasAccess) {
    return (
      <span className="flex items-center gap-1 text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full text-xs font-medium">
        <ShieldCheck className="w-3 h-3" />
        FMCSA access
      </span>
    );
  }

  function copyOnboardingUrl() {
    const url = `${window.location.origin}/portal/onboarding`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={copyOnboardingUrl}
      title="Click to copy portal onboarding URL"
      className="flex items-center gap-1 text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full text-xs font-medium hover:border-gray-300 hover:text-gray-500 transition-colors"
    >
      <ShieldAlert className="w-3 h-3" />
      FMCSA access needed
    </button>
  );
}
