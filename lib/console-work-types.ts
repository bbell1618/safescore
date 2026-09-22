import type { ChecklistItem, OperatorManualItem } from "@/lib/operator/checklist-types";
export type WorkRequest = {
  id: string; title: string; description: string | null; created_at: string; due_at: string | null;
  request_type: string | null; upload_token: string | null; reminder_count: number;
  reminder_limit: number; next_reminder_at: string | null; escalated_at: string | null;
};
export type WorkAlert = { id: string; title: string; message: string; severity: string; created_at: string; acknowledged_at: string | null };
export type ClientWorkData = {
  items: ChecklistItem[]; manualItems: OperatorManualItem[]; requests: WorkRequest[]; alerts: WorkAlert[];
  lastRefresh: string | null; now: string; appUrl: string;
  timing: Record<string, { createdAt: string | null; dueAt: string | null }>;
};
