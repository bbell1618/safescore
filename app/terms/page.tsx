import type { Metadata } from "next";
import { TermsView } from "@/components/legal/terms-view";
import { getTermsApproval } from "@/lib/legal/approval-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SafeScore Terms of Service",
  description: "SafeScore Terms of Service from Golden Era Insurance Agency.",
};

export default async function TermsPage() {
  // If the approval record cannot be read, show the terms as a draft.
  const approval = await getTermsApproval().catch(() => null);
  return <TermsView approval={approval} />;
}
