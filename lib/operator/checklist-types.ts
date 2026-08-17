import type {
  ComplianceHealthClearinghouseInput,
  ComplianceHealthDriverDocumentInput,
  ComplianceHealthDriverInput,
  ComplianceHealthVehicleInput,
} from "@/lib/compliance/health";
import type { ClientTier } from "@/lib/supabase/types";

export type ChecklistFamily =
  | "monitoring"
  | "reporting"
  | "evidence"
  | "cases"
  | "compliance"
  | "onboarding"
  | "service"
  | "gates";

export type ChecklistItemState =
  | "needs_you"
  | "waiting_client"
  | "waiting_gate";

export type ChecklistPriority = 1 | 2 | 3;

export type ChecklistItemAction = {
  kind: "request_driver_roster" | "copy_roster_link";
  label: string;
  value?: string;
};

/**
 * A derived operator action. `contextKey` is deliberately explicit because
 * acknowledgements apply to one rule occurrence, never to every future
 * occurrence of that rule.
 */
export type ChecklistItem = {
  id: string;
  ruleKey: string;
  contextKey: string;
  family: ChecklistFamily;
  state: ChecklistItemState;
  priority: ChecklistPriority;
  title: string;
  why: string;
  instructions: string[];
  href: string;
  canMarkDone: boolean;
  canSnooze: boolean;
  action?: ChecklistItemAction;
  defaultSnoozeDays?: number;
  snoozedUntil?: string;
};

export type ChecklistAlertContext = {
  id: string;
  createdAt: string;
  acknowledgedAt: string | null;
};

export type ChecklistSnapshotContext = {
  id: string;
  capturedAt: string;
  snapshotDate: string;
  source: string | null;
  totalPoints: number;
};

export type ChecklistReportContext = {
  id: string;
  type: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
};

export type ChecklistRequestContext = {
  id: string;
  status: string;
  responsibility: string;
  requestType: "evidence" | "question" | "roster_collection" | null;
  evidenceStatus: string | null;
  escalatedAt: string | null;
  nextReminderAt: string | null;
  createdAt: string;
  uploadToken: string;
  uploadUrl: string;
};

export type ChecklistCaseKind = "DataQ" | "CPDP";

export type ChecklistCaseContext = {
  id: string;
  kind: ChecklistCaseKind;
  caseNumber: string | null;
  status: string;
  createdAt: string;
  filedDate: string | null;
  determinationOutcome: string | null;
};

export type ChecklistPortalUserContext = {
  id: string;
  lastSignInAt: string | null;
};

export type ChecklistAckContext = {
  id: string;
  ruleKey: string;
  contextKey: string;
  action: "done" | "snooze";
  snoozedUntil: string | null;
  createdAt: string;
};

export type OperatorManualItem = {
  id: string;
  clientId: string;
  title: string;
  details: string | null;
  dueDate: string | null;
  status: "open" | "done";
  createdAt: string;
  completedAt: string | null;
  deletedAt: string | null;
};

export type ChecklistPendingDriverContext = {
  id: string;
  fullName: string;
  requestId: string | null;
  createdAt: string;
};

export type ChecklistComplianceContext = {
  /** False only when the production schema genuinely lacks the source tables. */
  available: boolean;
  /** Approved operational roster only. Pending client submissions stay separate. */
  drivers: ComplianceHealthDriverInput[];
  pendingDrivers: ChecklistPendingDriverContext[];
  driverDocuments: ComplianceHealthDriverDocumentInput[];
  vehicles: ComplianceHealthVehicleInput[];
  clearinghouseRecords: ComplianceHealthClearinghouseInput[];
};

/**
 * Complete, IO-free input for all client checklist rules. The server owns the
 * batched fetch and environment normalization; rules only read this object.
 */
export type OperatorWorkContext = {
  now: string;
  emailDeliveryDryRun: boolean;
  client: {
    id: string;
    name: string;
    tier: ClientTier;
    status: string;
  };
  /** Latest-first snapshots; the server loads the two most recent rows. */
  snapshots: ChecklistSnapshotContext[];
  alerts: ChecklistAlertContext[];
  reports: ChecklistReportContext[];
  requests: ChecklistRequestContext[];
  cases: ChecklistCaseContext[];
  compliance: ChecklistComplianceContext;
  portalUsers: ChecklistPortalUserContext[];
  manualItems: OperatorManualItem[];
  acknowledgements: ChecklistAckContext[];
};

/** Sanitized environment facts for the system-level Today gates. */
export type SystemGateContext = {
  emailDeliveryDryRun: boolean;
  lexisNexisWebhookConfigured: boolean;
  stripeSecretKeyMode: "test" | "live" | "unset";
};
