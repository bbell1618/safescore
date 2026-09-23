"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssessmentWaiverControl({ clientId, geiaInsured, waivedAt, waivedBy, paidAt }: {
  clientId: string; geiaInsured: boolean; waivedAt: string | null; waivedBy: string | null; paidAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change() {
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/assessment-waiver`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ geiaInsured: !geiaInsured }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Waiver update failed (${response.status})`);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  }
  return <section className="mt-5 space-y-3 rounded-lg border border-sand p-4" aria-label="Assessment payment">
    <h3 className="font-semibold text-navy">Assessment payment</h3>
    <p className="text-sm">GEIA insured clients receive the $299 one-time Assessment at no charge. This does not waive a recurring service subscription.</p>
    <button type="button" role="switch" aria-checked={geiaInsured} disabled={pending} onClick={() => void change()} className="btn-secondary min-h-11">GEIA insured: {geiaInsured ? "Yes — Assessment waived" : "No"}</button>
    {waivedAt && <p className="text-xs">Last waiver recorded {new Date(waivedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT by {waivedBy ?? "staff"}.</p>}
    {paidAt && <p className="text-sm">Assessment payment received {new Date(paidAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}.</p>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </section>;
}
