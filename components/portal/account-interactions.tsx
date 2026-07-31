"use client";

import { Check, Copy, Info } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "error";

export function CopyableAccountValue({
  label,
  value,
  children,
  mono = false,
}: {
  label: string;
  value: string;
  children?: ReactNode;
  mono?: boolean;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copyValue() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2200);
  }

  const feedback =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Copy unavailable"
        : null;

  return (
    <span className="relative inline-flex max-w-full items-center">
      <button
        type="button"
        onClick={copyValue}
        className={cn(
          "group/copy inline-flex min-h-10 max-w-full items-center gap-2 rounded-md px-2 -ml-2 text-left text-amber-dark underline decoration-amber/30 underline-offset-2 transition-[color,background-color,transform] duration-150",
          "hover:bg-amber-subtle hover:text-amber-hover active:translate-y-px",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          "motion-reduce:transform-none motion-reduce:transition-none",
          mono && "font-mono"
        )}
        aria-label={`Copy ${label}: ${value}`}
      >
        <span className="min-w-0 break-all">{children ?? value}</span>
        {copyState === "copied" ? (
          <Check
            className="h-4 w-4 shrink-0 text-success"
            aria-hidden="true"
          />
        ) : (
          <Copy
            className="h-4 w-4 shrink-0 opacity-60 transition-opacity md:opacity-0 md:group-hover/copy:opacity-100 md:group-focus-visible/copy:opacity-100"
            aria-hidden="true"
          />
        )}
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {feedback}
      </span>
      {feedback ? (
        <span
          className={cn(
            "pointer-events-none absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold shadow-md",
            copyState === "error"
              ? "bg-error text-warm-white"
              : "bg-navy text-warm-white"
          )}
          aria-hidden="true"
        >
          {feedback}
        </span>
      ) : null}
    </span>
  );
}

export function AccountSourceInfo({
  label,
  explanation,
  className,
}: {
  label: string;
  explanation: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex items-center", className)}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") setOpen(false);
      }}
    >
      <button
        type="button"
        className="group/source inline-flex min-h-10 items-center gap-1.5 rounded-md px-1.5 -ml-1.5 text-left text-xs leading-5 text-warm-gray transition-colors hover:bg-navy-subtle hover:text-navy active:bg-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <span>{label}</span>
        <Info
          className="h-4 w-4 shrink-0 opacity-60 transition-opacity group-hover/source:opacity-100 group-focus-visible/source:opacity-100"
          aria-hidden="true"
        />
      </button>
      {open ? (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute left-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-lg bg-navy px-3 py-2.5 text-xs leading-5 text-warm-white shadow-lg"
        >
          {explanation}
        </span>
      ) : null}
    </span>
  );
}
