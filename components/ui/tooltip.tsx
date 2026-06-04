"use client";
import { useState } from "react";

interface TooltipProps {
  content: string;
  position?: "top" | "bottom";
}

export function Tooltip({ content, position = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        className="ml-1 text-gray-400 hover:text-[#C67A1E] focus:text-[#C67A1E] focus:outline-none text-[11px] leading-none"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="More information"
        tabIndex={0}
      >
        ⓘ
      </button>
      {open && (
        <span
          className={`absolute z-50 w-72 rounded-lg bg-[#1E1C1A] text-white text-[11px] leading-relaxed p-3 shadow-xl pointer-events-none
            ${position === "top" ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5" : "top-full left-1/2 -translate-x-1/2 mt-1.5"}`}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  );
}
