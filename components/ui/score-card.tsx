import { cn, scoreToColor, scoreToBg } from "@/lib/utils";
import { AlertTriangle, CheckCircle, Minus } from "lucide-react";

interface ScoreCardProps {
  label: string;
  measure: number | null;
  percentile: number | null;
  alert?: boolean;
  compact?: boolean;
}

export function ScoreCard({ label, measure, percentile, alert, compact }: ScoreCardProps) {
  const hasData = measure !== null;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex flex-col gap-1",
        hasData ? scoreToBg(percentile) : "bg-gray-50 border-gray-200",
        compact ? "p-3" : "p-4"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-xs font-medium text-gray-500 leading-tight"
        >
          {label}
        </p>
        {hasData && alert && (
          <AlertTriangle className="w-3.5 h-3.5 text-[#DC362E] shrink-0 mt-0.5" />
        )}
        {hasData && !alert && percentile !== null && percentile < 65 && (
          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
        )}
        {!hasData && <Minus className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
      </div>

      {hasData ? (
        <>
          <p
            className={cn("text-2xl font-bold leading-none", scoreToColor(percentile))}
          >
            {measure?.toFixed(1)}
          </p>
          {percentile !== null && (
            <p className="text-xs text-gray-500">
              {percentile}th percentile
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400">No data</p>
      )}
    </div>
  );
}
