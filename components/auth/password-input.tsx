"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** QF-227 (Brandon, 11/24/2026): password fields get an eye button to show what was typed. */
export function PasswordInput({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={cn(className, "pr-11")} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-[#6B6158] transition-colors duration-200 hover:text-[#1B2D4F] focus-visible:outline-2 focus-visible:outline-[#E69634]"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
