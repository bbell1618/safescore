"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  CirclePlus,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  ListOrdered,
  Loader2,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  ChecklistFamily,
  ChecklistItem,
  ChecklistItemState,
  OperatorManualItem,
} from "@/lib/operator/checklist-types";

type ChecklistPayload = {
  items?: ChecklistItem[];
  manualItems?: OperatorManualItem[];
  error?: string;
};

type PendingAction =
  | `ack:${string}`
  | `manual:${string}`
  | "manual:create"
  | null;

const FAMILY_LABELS: Record<ChecklistFamily, string> = {
  monitoring: "Monitoring",
  reporting: "Reporting",
  evidence: "Evidence",
  cases: "Cases",
  compliance: "Compliance",
  onboarding: "Onboarding",
  service: "Service",
  gates: "System gate",
};

const STATE_SECTIONS: ReadonlyArray<{
  state: ChecklistItemState;
  label: string;
  description: string;
}> = [
  {
    state: "needs_you",
    label: "Needs you",
    description: "Work that requires an operator decision or action.",
  },
  {
    state: "waiting_client",
    label: "Waiting on client",
    description: "SafeScore is tracking these while the carrier responds.",
  },
  {
    state: "waiting_gate",
    label: "Waiting on gates",
    description: "Work paused by a system or delivery gate.",
  },
];

const SECTION_ICONS: Record<ChecklistItemState, typeof AlertCircle> = {
  needs_you: AlertCircle,
  waiting_client: UsersRound,
  waiting_gate: Clock3,
};

function formatDate(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3])
        )
      )
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: dateOnly ? "UTC" : "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

async function jsonBody(response: Response): Promise<ChecklistPayload> {
  return (await response.json().catch(() => ({}))) as ChecklistPayload;
}

function familyVariant(
  family: ChecklistFamily
): "danger" | "warning" | "info" | "outline" | "gold" {
  if (family === "monitoring" || family === "cases") return "danger";
  if (family === "reporting" || family === "evidence") return "warning";
  if (family === "service" || family === "compliance") return "gold";
  if (family === "gates") return "info";
  return "outline";
}

function ChecklistCard({
  clientId,
  item,
  pending,
  onAcknowledge,
}: {
  clientId: string;
  item: ChecklistItem;
  pending: PendingAction;
  onAcknowledge: (
    item: ChecklistItem,
    action: "done" | "snooze"
  ) => Promise<void>;
}) {
  const busy = pending === `ack:${item.id}`;
  const snoozeDays = item.defaultSnoozeDays ?? 14;

  return (
    <article
      className={`rounded-xl border p-4 shadow-sm ${
        item.state === "needs_you"
          ? "border-[#E5D3B8] bg-white"
          : item.state === "waiting_client"
            ? "border-[#D9E8DD] bg-[#F3F8F4]"
            : "border-[#E7DDCE] bg-[#FBF7F0]"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={familyVariant(item.family)}>
              {FAMILY_LABELS[item.family]}
            </Badge>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              Priority {item.priority}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-5 text-[#1E1C1A]">
            {item.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">{item.why}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.canMarkDone ? (
            <button
              type="button"
              onClick={() => void onAcknowledge(item, "done")}
              disabled={pending !== null}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-semibold text-[#4D463E] transition-colors hover:border-[#3D7A52] hover:text-[#315E3E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Mark done
            </button>
          ) : null}
          {item.canSnooze ? (
            <button
              type="button"
              onClick={() => void onAcknowledge(item, "snooze")}
              disabled={pending !== null}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-semibold text-[#4D463E] transition-colors hover:border-[#C67A1E] hover:text-[#9A5A14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clock3 className="h-3.5 w-3.5" />
              )}
              Snooze {snoozeDays} days
            </button>
          ) : null}
          {item.href.trim() ? (
            <Link
              href={item.href}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#1B2D4F] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2A4270] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
              aria-label={`Go to ${item.title}`}
            >
              Go
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      <details className="mt-3 rounded-lg border border-[#E7DDCE] bg-[#FEFCF8]">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-[#4D463E] marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]">
          <ListOrdered className="h-3.5 w-3.5 text-[#C67A1E]" />
          Do this next
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-gray-400" />
        </summary>
        <ol className="space-y-2 border-t border-[#E7DDCE] px-8 py-3 text-xs leading-5 text-gray-600">
          {item.instructions.map((instruction, index) => (
            <li key={`${item.id}:step:${index}`} className="list-decimal pl-1">
              {instruction}
            </li>
          ))}
        </ol>
      </details>
      <span className="sr-only">Client {clientId}</span>
    </article>
  );
}

function ManualItems({
  clientId,
  items,
  pending,
  onCreate,
  onUpdate,
}: {
  clientId: string;
  items: OperatorManualItem[];
  pending: PendingAction;
  onCreate: (title: string, dueDate: string) => Promise<boolean>;
  onUpdate: (item: OperatorManualItem, action: "toggle" | "delete") => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await onCreate(title, dueDate))) return;
    setTitle("");
    setDueDate("");
    setAdding(false);
  }

  return (
    <section aria-labelledby="manual-items-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-[#8E7340]" />
            <h2 id="manual-items-heading" className="text-base font-semibold text-[#1E1C1A]">
              Manual items
            </h2>
            <Badge variant="outline">{items.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Ad-hoc operator work that cannot be derived from SafeScore data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((current) => !current)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-semibold text-[#4D463E] transition-colors hover:border-[#C67A1E] hover:text-[#9A5A14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
          aria-expanded={adding}
          aria-controls="manual-item-form"
        >
          <CirclePlus className="h-4 w-4" />
          Add item
        </button>
      </div>

      {adding ? (
        <form
          id="manual-item-form"
          onSubmit={submit}
          className="grid gap-3 rounded-xl border border-[#E5D9C8] bg-[#FBF7F0] p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
        >
          <label className="text-xs font-medium text-[#4D463E]">
            Title
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Call the carrier about…"
              className="mt-1 min-h-10 w-full rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E] focus:ring-2 focus:ring-[#C67A1E]/20"
            />
          </label>
          <label className="text-xs font-medium text-[#4D463E]">
            Due date (optional)
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E] focus:ring-2 focus:ring-[#C67A1E]/20"
            />
          </label>
          <button
            type="submit"
            disabled={pending !== null || !title.trim()}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[#1B2D4F] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2A4270] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "manual:create" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Save item
          </button>
        </form>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[#E7DDCE] bg-white">
          <ul className="divide-y divide-[#F0E8DA]">
            {items.map((item) => {
              const busy = pending === `manual:${item.id}`;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <button
                    type="button"
                    onClick={() => void onUpdate(item, "toggle")}
                    disabled={pending !== null}
                    className={`flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:opacity-50 ${
                      item.status === "done"
                        ? "border-[#3D7A52] bg-[#E8F3EC] text-[#315E3E]"
                        : "border-[#D8CCBA] bg-white text-gray-400 hover:border-[#3D7A52] hover:text-[#315E3E]"
                    }`}
                    aria-label={
                      item.status === "done"
                        ? `Reopen ${item.title}`
                        : `Mark ${item.title} done`
                    }
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium ${
                        item.status === "done"
                          ? "text-gray-400 line-through"
                          : "text-[#1E1C1A]"
                      }`}
                    >
                      {item.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {item.dueDate ? <span>Due {formatDate(item.dueDate)}</span> : null}
                      <Badge variant={item.status === "done" ? "success" : "outline"}>
                        {item.status === "done" ? "Done" : "Open"}
                      </Badge>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onUpdate(item, "delete")}
                    disabled={pending !== null}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center self-end rounded-lg text-gray-400 transition-colors hover:bg-[#FAECEB] hover:text-[#A33A32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:opacity-50 sm:self-auto"
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#D8CCBA] bg-[#FBF7F0] px-4 py-8 text-center text-sm text-gray-500">
          No manual items. Add one only when the work cannot be derived from live data.
        </div>
      )}
      <span className="sr-only">Manual items for client {clientId}</span>
    </section>
  );
}

export function OperatorChecklist({
  clientId,
  initialItems,
  initialManualItems,
}: {
  clientId: string;
  initialItems: ChecklistItem[];
  initialManualItems: OperatorManualItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [manualItems, setManualItems] = useState(initialManualItems);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = {
    needs_you: items.filter((item) => item.state === "needs_you").length,
    waiting_client: items.filter((item) => item.state === "waiting_client").length,
    waiting_gate: items.filter((item) => item.state === "waiting_gate").length,
  };

  async function reload() {
    const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/checklist`, {
      cache: "no-store",
    });
    const payload = await jsonBody(response);
    if (!response.ok || !payload.items || !payload.manualItems) {
      throw new Error(
        payload.error ?? `Checklist reload failed with HTTP ${response.status}`
      );
    }
    setItems(payload.items);
    setManualItems(payload.manualItems);
  }

  async function acknowledge(
    item: ChecklistItem,
    action: "done" | "snooze"
  ) {
    const actionKey = `ack:${item.id}` as const;
    setPending(actionKey);
    setError(null);
    setMessage(null);
    try {
      const snoozedUntil =
        action === "snooze"
          ? new Date(
              Date.now() + (item.defaultSnoozeDays ?? 14) * 86_400_000
            ).toISOString()
          : undefined;
      const response = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/checklist/ack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ruleKey: item.ruleKey,
            contextKey: item.contextKey,
            action,
            ...(snoozedUntil ? { snoozedUntil } : {}),
          }),
        }
      );
      const payload = await jsonBody(response);
      if (!response.ok) {
        throw new Error(
          payload.error ?? `Checklist action failed with HTTP ${response.status}`
        );
      }
      await reload();
      setMessage(
        action === "done"
          ? `Marked “${item.title}” done for this occurrence.`
          : `Snoozed “${item.title}” for ${item.defaultSnoozeDays ?? 14} days.`
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unknown checklist action failure"
      );
    } finally {
      setPending(null);
    }
  }

  async function createManual(title: string, dueDate: string) {
    setPending("manual:create");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/checklist/manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            ...(dueDate ? { dueDate } : {}),
          }),
        }
      );
      const payload = await jsonBody(response);
      if (!response.ok) {
        throw new Error(
          payload.error ?? `Manual item creation failed with HTTP ${response.status}`
        );
      }
      await reload();
      setMessage("Manual item added.");
      return true;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unknown manual item creation failure"
      );
      return false;
    } finally {
      setPending(null);
    }
  }

  async function updateManual(
    item: OperatorManualItem,
    action: "toggle" | "delete"
  ) {
    if (
      action === "delete" &&
      !window.confirm(`Remove the manual item “${item.title}”?`)
    ) {
      return;
    }
    setPending(`manual:${item.id}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/checklist/manual/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "delete"
              ? { deleted: true }
              : { status: item.status === "done" ? "open" : "done" }
          ),
        }
      );
      const payload = await jsonBody(response);
      if (!response.ok) {
        throw new Error(
          payload.error ?? `Manual item update failed with HTTP ${response.status}`
        );
      }
      await reload();
      setMessage(action === "delete" ? "Manual item removed." : "Manual item updated.");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unknown manual item update failure"
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8E7340]">
          Derived from live client state
        </p>
        <h1 className="mt-1 text-xl font-bold text-[#1E1C1A]">Operator checklist</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
          Work clears when its source condition clears. Manual items are reserved for
          work SafeScore cannot derive.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border-2 border-[#B83B32] bg-[#FAECEB] px-4 py-3 text-sm font-medium text-[#8D2E28]"
        >
          Checklist action failed: {error}
        </div>
      ) : null}
      {message ? (
        <div
          role="status"
          className="rounded-xl border border-[#BFD8C7] bg-[#E8F3EC] px-4 py-3 text-sm text-[#315E3E]"
        >
          {message}
        </div>
      ) : null}

      {STATE_SECTIONS.map((section) => {
        const sectionItems = items.filter((item) => item.state === section.state);
        const Icon = SECTION_ICONS[section.state];
        return (
          <section
            key={section.state}
            aria-labelledby={`checklist-${section.state}`}
            className="space-y-3"
          >
            <div className="flex items-start gap-2">
              <Icon
                className={`mt-0.5 h-4 w-4 ${
                  section.state === "needs_you"
                    ? "text-[#B83B32]"
                    : section.state === "waiting_client"
                      ? "text-[#3D7A52]"
                      : "text-[#8E7340]"
                }`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id={`checklist-${section.state}`}
                    className="text-base font-semibold text-[#1E1C1A]"
                  >
                    {section.label}
                  </h2>
                  <Badge variant={section.state === "needs_you" ? "danger" : "outline"}>
                    {sectionItems.length}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{section.description}</p>
              </div>
            </div>

            {sectionItems.length > 0 ? (
              <div className="space-y-3">
                {sectionItems.map((item) => (
                  <ChecklistCard
                    key={item.id}
                    clientId={clientId}
                    item={item}
                    pending={pending}
                    onAcknowledge={acknowledge}
                  />
                ))}
              </div>
            ) : section.state === "needs_you" ? (
              <div className="rounded-xl border border-[#BFD8C7] bg-[#F3F8F4] px-4 py-5 text-sm text-[#315E3E]">
                <span className="font-semibold">Nothing needs you right now</span>
                {` — ${counts.waiting_client} waiting on client, ${counts.waiting_gate} waiting on gates.`}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#D8CCBA] bg-[#FBF7F0] px-4 py-5 text-sm text-gray-500">
                Nothing in this state.
              </div>
            )}
          </section>
        );
      })}

      <ManualItems
        clientId={clientId}
        items={manualItems}
        pending={pending}
        onCreate={createManual}
        onUpdate={updateManual}
      />
    </div>
  );
}
