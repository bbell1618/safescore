import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { getPortalPageAccess } from "@/lib/portal/access";
import DocumentVault from "./document-vault";

export const dynamic = "force-dynamic";

export default async function PortalDocumentsPage() {
  const access = await getPortalPageAccess("compliance_layer");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        feature="compliance_layer"
        currentTier={access.tier}
        title="The compliance document vault is not included in your plan"
      />
    );
  }
  return <DocumentVault />;
}
