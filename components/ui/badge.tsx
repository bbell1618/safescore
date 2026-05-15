import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline"
  | "gold";

const variants: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-700",
  success: "bg-[#E8F3EC] text-[#3D7A52]",
  warning: "bg-[#FDF4E7] text-[#C67A1E]",
  danger: "bg-[#FAECEB] text-[#B83B32]",
  info: "bg-[#F5EDDB] text-[#8E7340]",
  outline: "border border-[#F0E8DA] text-gray-600 bg-white",
  gold: "bg-amber-50 text-[#C67A1E] border border-amber-200",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
