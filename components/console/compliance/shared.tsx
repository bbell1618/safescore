import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const inputClass =
  "min-h-10 w-full rounded-lg border border-[#E5D9C8] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none transition focus:border-[#C67A1E] focus:ring-2 focus:ring-[#C67A1E]/15 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[#E5D9C8] bg-white px-3 py-2 text-xs font-semibold text-[#1E1C1A] transition hover:border-[#C67A1E] hover:text-[#A85F15] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-60";

export const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-[#C67A1E] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#A85F15] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-60";

export function formatComplianceDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

const healthLabels: Record<string, string> = {
  on_file: "On file",
  compliant: "On file",
  expiring: "Expiring",
  expired: "Expired",
  missing: "Missing",
};

export function ComplianceStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const variant =
    status === "on_file" || status === "compliant"
      ? "success"
      : status === "expiring"
        ? "warning"
        : status === "expired"
          ? "danger"
          : "outline";
  return (
    <Badge variant={variant} className={className}>
      {healthLabels[status] ?? status}
    </Badge>
  );
}

export function RosterStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "active" ? "success" : "default"}>
      {status === "active"
        ? "Active"
        : status === "terminated"
          ? "Terminated"
          : "Inactive"}
    </Badge>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

export function MutationMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-xs leading-5 text-gray-600" role="status">
      {message}
    </p>
  );
}

export function SectionFrame({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#F0E8DA] bg-[#FBF7F0]">
      <div className="flex flex-col gap-3 border-b border-[#F0E8DA] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#1E1C1A]">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
            {description}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
