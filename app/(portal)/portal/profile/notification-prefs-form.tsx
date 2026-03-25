"use client";

import { useState, useEffect } from "react";

interface NotificationPrefs {
  new_violations: boolean;
  case_status_changes: boolean;
  score_changes: boolean;
  monthly_reports: boolean;
}

const defaultPrefs: NotificationPrefs = {
  new_violations: true,
  case_status_changes: true,
  score_changes: true,
  monthly_reports: true,
};

const PREF_LABELS: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  {
    key: "new_violations",
    label: "New violations",
    description: "Email when a new violation is added to your record",
  },
  {
    key: "case_status_changes",
    label: "Case status changes",
    description: "Email when a DataQ or CPDP case changes status",
  },
  {
    key: "score_changes",
    label: "Score changes",
    description: "Email when your BASIC percentile scores update",
  },
  {
    key: "monthly_reports",
    label: "Monthly reports",
    description: "Email when your monthly safety report is ready",
  },
];

export function NotificationPrefsForm() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/portal/notification-prefs")
      .then((r) => r.json())
      .then((data) => {
        if (data.prefs) setPrefs({ ...defaultPrefs, ...data.prefs });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/portal/notification-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // fail silently
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="w-10 h-5 bg-gray-200 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {PREF_LABELS.map(({ key, label, description }) => (
        <div
          key={key}
          className="flex items-start justify-between gap-4 py-3 border-b border-[#E5E5E5] last:border-0"
        >
          <div>
            <p className="text-sm font-medium text-[#1A1A1A]">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[key]}
            onClick={() => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:ring-offset-2 ${
              prefs[key] ? "bg-[#DC362E]" : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                prefs[key] ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      ))}

      <div className="pt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-[#DC362E] text-white text-sm font-medium rounded-lg hover:bg-[#A3221C] transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save preferences"}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">Saved</span>
        )}
      </div>
    </div>
  );
}
