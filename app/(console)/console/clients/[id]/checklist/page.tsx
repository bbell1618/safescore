import { OperatorChecklist } from "@/components/console/operator-checklist";
import { getClientChecklist } from "@/lib/operator/checklist-server";

export const dynamic = "force-dynamic";

export default async function ClientChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let checklist: Awaited<ReturnType<typeof getClientChecklist>> | null = null;
  let loadError: string | null = null;

  try {
    checklist = await getClientChecklist(id);
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unknown checklist loading failure";
  }

  if (!checklist || loadError) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-6">
        <section
          role="alert"
          className="rounded-xl border-2 border-[#B83B32] bg-[#FAECEB] p-6 text-[#8D2E28] shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">
            Checklist unavailable
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            SafeScore could not prove the current operator work state.
          </h1>
          <p className="mt-2 text-sm leading-6">
            {loadError ?? "The checklist did not return a usable context."}
          </p>
          <p className="mt-3 text-xs">
            No all-clear is shown. Resolve the data-loading failure and reload this page.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <OperatorChecklist
        clientId={id}
        initialItems={checklist.items}
        initialManualItems={checklist.manualItems}
      />
    </main>
  );
}
