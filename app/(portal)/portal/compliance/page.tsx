import { ClipboardCheck } from "lucide-react";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { getPortalPageAccess } from "@/lib/portal/access";

export const dynamic = "force-dynamic";

export default async function PortalCompliancePage() {
  const access = await getPortalPageAccess("compliance_layer");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        feature="compliance_layer"
        currentTier={access.tier}
        title="The compliance layer is not included in your plan"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1E1C1A]">Compliance</h1>
        <p className="mt-1 text-sm text-gray-500">Your Total Safety compliance workspace.</p>
      </div>
      <div className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] px-6 py-12 text-center">
        <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-[#C67A1E]" />
        <p className="text-sm font-medium text-[#1E1C1A]">Compliance sweep coming next</p>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-gray-500">
          Your team can continue using the document vault while the dedicated compliance sweep is being prepared. No compliance conclusion is shown until the required data is available.
        </p>
      </div>
    </div>
  );
}
