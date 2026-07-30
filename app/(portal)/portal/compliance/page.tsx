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
      <header>
        <p className="mono-label text-amber">Compliance workspace</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-warm-dark">
          Compliance
        </h1>
        <p className="mt-2 text-sm leading-6 text-warm-mid">
          Your Total Safety compliance workspace.
        </p>
      </header>
      <section className="rounded-xl border border-sand bg-warm-white px-6 py-12 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-subtle text-amber-dark">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-heading text-lg font-semibold text-warm-dark">
          The dedicated compliance sweep is being prepared
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-warm-mid">
          You can keep using the document vault while GEIA prepares this
          workspace. No compliance conclusion appears until the required data
          is available.
        </p>
      </section>
    </div>
  );
}
