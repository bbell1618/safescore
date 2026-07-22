import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { filedAuthorizationPresentation } from "@/lib/cases/presentation";

interface FiledAuthorizationStatusProps {
  clientId: string;
  filingAuthorized: boolean;
  filingAuthorizedBy: string | null;
  filingAuthorizationScope: string | null;
}

export function FiledAuthorizationStatus({
  clientId,
  filingAuthorized,
  filingAuthorizedBy,
  filingAuthorizationScope,
}: FiledAuthorizationStatusProps) {
  const presentation = filedAuthorizationPresentation(filingAuthorized);

  if (presentation.state === "missing") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <p className="font-semibold">{presentation.message}</p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] p-3 text-xs text-gray-600">
      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
      <div>
        <p className="font-medium text-[#1E1C1A]">{presentation.message}</p>
        {(filingAuthorizedBy || filingAuthorizationScope) && (
          <p className="mt-0.5 text-[11px] text-gray-500">
            {[filingAuthorizedBy, filingAuthorizationScope].filter(Boolean).join(" \u00B7 ")}
          </p>
        )}
        <Link
          href={`/console/clients/${clientId}/account`}
          className="mt-1 inline-block font-medium text-[#8B5E2B] hover:underline"
        >
          View authorization record
        </Link>
      </div>
    </div>
  );
}
