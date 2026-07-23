import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function ClientRequestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("client_requests")
    .select(
      "id, title, source, status, reminder_count, reminder_limit, next_reminder_at, escalated_at, created_at, requested_items"
    )
    .eq("client_id", id)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Unable to load client requests: ${error.message}`);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-[#1E1C1A]">
          Client Request Queue
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Oldest requests appear first, with weekly reminder count, escalation
          state, and evidence workload.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#F0E8DA] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#FBF7F0] text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Request</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Reminders</th>
              <th className="px-4 py-3">Next</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0E8DA]">
            {(rows ?? []).map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.title}</p>
                  <p className="text-xs text-gray-400">
                    {row.source} ·{" "}
                    {Array.isArray(row.requested_items)
                      ? row.requested_items.length
                      : 0}{" "}
                    evidence items
                  </p>
                </td>
                <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">
                  {row.reminder_count}/{row.reminder_limit}
                </td>
                <td className="px-4 py-3 text-xs">
                  {row.next_reminder_at
                    ? formatDate(row.next_reminder_at)
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.escalated_at
                        ? "text-red-700"
                        : row.status === "fulfilled"
                          ? "text-green-700"
                          : "text-amber-700"
                    }
                  >
                    {row.escalated_at ? "Escalated" : row.status}
                  </span>
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-gray-500"
                >
                  <p>No client requests yet.</p>
                  <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-gray-400">
                    Requests are created when SafeScore needs evidence or
                    documents from the carrier — reminders and escalation are
                    tracked automatically.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
