import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDot(dot: string): string {
  return `DOT ${dot}`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function scoreToColor(percentile: number | null): string {
  if (percentile === null) return "text-gray-400";
  if (percentile >= 80) return "text-[#DC362E]"; // alert
  if (percentile >= 65) return "text-[#C5A059]"; // warning
  return "text-green-600"; // ok
}

export function scoreToBg(percentile: number | null): string {
  if (percentile === null) return "bg-gray-100";
  if (percentile >= 80) return "bg-red-50 border-red-200";
  if (percentile >= 65) return "bg-amber-50 border-amber-200";
  return "bg-green-50 border-green-200";
}

export function priorityVariant(priority: string): "danger" | "warning" | "info" {
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  return "info";
}

export function caseStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    filed: "Filed",
    pending_state: "Pending state",
    pending_fmcsa: "Pending FMCSA",
    approved: "Approved",
    denied: "Denied",
    reconsidering: "Reconsidering",
    closed: "Closed",
  };
  return labels[status] ?? status;
}

export function caseStatusVariant(status: string): "default" | "info" | "warning" | "success" | "danger" | "outline" {
  const variants: Record<string, "default" | "info" | "warning" | "success" | "danger" | "outline"> = {
    draft: "outline",
    filed: "info",
    pending_state: "warning",
    pending_fmcsa: "warning",
    approved: "success",
    denied: "danger",
    reconsidering: "warning",
    closed: "default",
  };
  return variants[status] ?? "default";
}
