import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChecklistItem } from "@/lib/operator/checklist-types";

export type OperatorTodayItem = ChecklistItem & {
  clientId: string;
  clientName: string;
};

export function OperatorToday({
  items,
  gates,
  error,
}: {
  items: OperatorTodayItem[];
  gates: ChecklistItem[];
  error: string | null;
}) {
  return (
    <section aria-labelledby="operator-today-heading" className="mb-7 space-y-3">
      <div className="overflow-hidden rounded-xl border border-[#D8CCBA] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1B2D4F] px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F2C76E]">
              Primary operating surface
            </p>
            <h1 id="operator-today-heading" className="mt-0.5 text-lg font-semibold">
              Today
            </h1>
          </div>
          <Badge
            variant={error ? "danger" : "gold"}
            className={
              error
                ? undefined
                : "border-[#D9A441]/50 bg-[#D9A441]/15 text-[#F9E5B7]"
            }
          >
            {error
              ? "Context error"
              : `${items.length} need${items.length === 1 ? "s" : ""} you`}
          </Badge>
        </div>

        {error ? (
          <div
            role="alert"
            className="border-t-4 border-[#B83B32] bg-[#FAECEB] px-5 py-5 text-[#8D2E28]"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">
                  Today could not load a complete operator context.
                </p>
                <p className="mt-1 text-sm leading-6">{error}</p>
                <p className="mt-2 text-xs font-medium">
                  No all-clear is shown. Resolve this failure before relying on the queue.
                </p>
              </div>
            </div>
          </div>
        ) : items.length > 0 ? (
          <ul className="divide-y divide-[#F0E8DA]">
            {items.map((item) => (
              <li key={`${item.clientId}:${item.id}`} className="px-5 py-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.priority === 1 ? "danger" : "outline"}>
                        P{item.priority}
                      </Badge>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                        {item.family}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-[#1E1C1A]">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-gray-500">{item.why}</p>
                  </div>
                  {item.href.trim() ? (
                    <Link
                      href={item.href}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-[#FBF7F0] px-3 py-2 text-xs font-semibold text-[#4D463E] transition-colors hover:border-[#C67A1E] hover:text-[#9A5A14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
                    >
                      Open checklist
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-5 py-6 text-[#315E3E]">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">
              No derived client work needs you right now.
            </p>
          </div>
        )}
      </div>

      {!error && gates.length > 0 ? (
        <div className="rounded-xl border border-[#E5D3B8] bg-[#FDF4E7] px-5 py-4">
          <div className="flex items-center gap-2 text-[#9A5A14]">
            <ShieldAlert className="h-4 w-4" />
            <h2 className="text-sm font-semibold">System gates</h2>
            <Badge variant="warning">{gates.length}</Badge>
          </div>
          <ul className="mt-3 space-y-2">
            {gates.map((gate) => (
              <li key={gate.id} className="rounded-lg border border-[#E5D3B8] bg-white/70 px-3 py-2.5">
                <p className="text-sm font-medium text-[#4D463E]">{gate.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[#7A6547]">{gate.why}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
