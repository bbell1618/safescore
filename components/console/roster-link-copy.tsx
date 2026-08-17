"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function RosterLinkCopy({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch (copyError) {
      setCopied(false);
      setError(
        copyError instanceof Error ? copyError.message : "Unable to copy the link."
      );
    }
  }

  return (
    <div>
      <div
        className={
          compact
            ? "mt-2 flex max-w-xl items-center gap-2"
            : "mt-3 flex items-center gap-2 rounded-lg border border-[#D8CCBA] bg-white p-3"
        }
      >
        <code
          className={`min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-[#4D463E] ${
            compact ? "rounded-md bg-[#FBF7F0] px-2 py-1" : ""
          }`}
        >
          {url}
        </code>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-semibold text-[#4D463E] transition hover:border-[#C67A1E] hover:text-[#9A5A14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
          aria-label="Copy driver-list link"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
