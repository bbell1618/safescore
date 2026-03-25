"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "safescore_onboarding_dismissed";

export function OnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="rounded-xl border border-amber-300 px-5 py-4 flex items-start justify-between gap-4"
      style={{ backgroundColor: "#C5A059" }}
    >
      <div className="flex-1">
        <p
          className="text-white font-semibold text-sm"
        >
          Welcome to SafeScore
        </p>
        <p className="text-white/90 text-sm mt-0.5">
          Your GEIA team has been notified and will begin your initial assessment within 24 hours.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
