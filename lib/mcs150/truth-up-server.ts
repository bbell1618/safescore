import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SAFERSnapshot } from "@/lib/fmcsa/safer";
import { computeMcs150BiennialClock } from "@/lib/mcs150/biennial";
import {
  compareMcs150Profiles,
  evaluateMcs150TruthUp,
  shouldRunMcs150ScheduledCheck,
  type Mcs150ProfileValues,
  type Mcs150TruthUpEvaluation,
} from "@/lib/mcs150/truth-up";

const OPEN_UPDATE_STATUSES = [
  "draft",
  "pending_review",
  "submitted",
] as const;

type AttestedProfileRow = Mcs150ProfileValues & {
  id: string;
  source: "census_default" | "operator_recorded";
  attested_at: string | null;
};

type OpenUpdateRow = {
  id: string;
  client_request_id: string | null;
  proposed_changes: Record<string, unknown>;
  census_snapshot: Record<string, unknown> | null;
  submitted_date: string | null;
};

export interface Mcs150ReconciliationResult {
  checked: number;
  confirmedUpdateIds: string[];
  fulfilledRequestIds: string[];
  waitingForFreshFields: Array<{
    updateId: string;
    fields: string[];
  }>;
}

export interface Mcs150QuarterlyResult {
  status:
    | "succeeded"
    | "failed"
    | "skipped_already_checked"
    | "skipped_not_in_tier";
  quarterKey: string;
  reason: string;
  evaluation: Mcs150TruthUpEvaluation | null;
  updateId: string | null;
  requestId: string | null;
  artifactsCreated: boolean;
}

export interface Mcs150TruthUpRunResult {
  reconciliation: Mcs150ReconciliationResult;
  quarterly: Mcs150QuarterlyResult;
}

export interface RunMcs150TruthUpInput {
  clientId: string;
  clientName: string;
  dotNumber: string;
  complianceIncluded: boolean;
  freshCensus: SAFERSnapshot | null;
  burdenPoints: number | null;
  now?: Date;
}

function dbError(
  label: string,
  error: {
    message: string;
    details?: string | null;
    hint?: string | null;
  },
): Error {
  return new Error(
    `${label}: ${error.message}${error.details ? `; ${error.details}` : ""}${
      error.hint ? `; ${error.hint}` : ""
    }`,
  );
}

function pacificDateParts(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function pacificDate(now: Date): string {
  const { year, month, day } = pacificDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

export function mcs150QuarterKey(now = new Date()): string {
  const { year, month } = pacificDateParts(now);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

export function mcs150CensusValues(
  snapshot: SAFERSnapshot,
): Mcs150ProfileValues {
  return {
    power_units: snapshot.powerUnits,
    drivers: snapshot.drivers,
    annual_mileage: snapshot.mcs150Mileage,
    mileage_year: snapshot.mcs150MileageYear,
    operation_classification: snapshot.operationClassification,
    cargo_types: snapshot.cargoTypes,
    physical_address: snapshot.physicalAddress,
    mailing_address: snapshot.mailingAddress,
    // SAFER's public company snapshot does not publish company officials.
    officials: null,
  };
}

function attestedValues(row: AttestedProfileRow): Mcs150ProfileValues {
  return {
    power_units: row.power_units,
    drivers: row.drivers,
    annual_mileage: row.annual_mileage,
    mileage_year: row.mileage_year,
    operation_classification: row.operation_classification ?? null,
    cargo_types: row.cargo_types ?? [],
    physical_address: row.physical_address ?? null,
    mailing_address: row.mailing_address ?? null,
    officials: row.officials ?? [],
  };
}

export function comparableMcs150Proposal(
  census: Mcs150ProfileValues,
  attested: Mcs150ProfileValues,
): Mcs150ProfileValues {
  return {
    power_units: attested.power_units,
    drivers: attested.drivers,
    annual_mileage: attested.annual_mileage,
    mileage_year: attested.mileage_year,
    operation_classification:
      census.operation_classification == null
        ? null
        : attested.operation_classification ?? null,
    cargo_types:
      (census.cargo_types?.length ?? 0) === 0
        ? null
        : attested.cargo_types ?? [],
    physical_address:
      census.physical_address == null
        ? null
        : attested.physical_address ?? null,
    mailing_address:
      census.mailing_address == null
        ? null
        : attested.mailing_address ?? null,
    officials:
      (census.officials?.length ?? 0) === 0
        ? null
        : attested.officials ?? [],
  };
}

function requiredFreshFields(
  census: Mcs150ProfileValues,
  proposed: Mcs150ProfileValues,
): string[] {
  const missing: string[] = [];
  const fields: Array<keyof Mcs150ProfileValues> = [
    "power_units",
    "drivers",
    "annual_mileage",
    "mileage_year",
    "operation_classification",
    "cargo_types",
    "physical_address",
    "mailing_address",
    "officials",
  ];
  for (const field of fields) {
    const proposedValue = proposed[field];
    const censusValue = census[field];
    const proposalHasValue = Array.isArray(proposedValue)
      ? proposedValue.length > 0
      : proposedValue !== null && proposedValue !== undefined;
    const censusHasValue = Array.isArray(censusValue)
      ? censusValue.length > 0
      : censusValue !== null && censusValue !== undefined;
    if (proposalHasValue && !censusHasValue) missing.push(field);
  }
  return missing;
}

function parseProposedChanges(
  value: Record<string, unknown>,
): Mcs150ProfileValues {
  const numeric = (field: string) =>
    typeof value[field] === "number" ? (value[field] as number) : null;
  const stringValue = (field: string) =>
    typeof value[field] === "string" ? (value[field] as string) : null;
  const strings = (field: string) =>
    Array.isArray(value[field])
      ? (value[field] as unknown[]).filter(
          (item): item is string => typeof item === "string",
        )
      : null;
  return {
    power_units: numeric("power_units"),
    drivers: numeric("drivers"),
    annual_mileage: numeric("annual_mileage"),
    mileage_year: numeric("mileage_year"),
    operation_classification: stringValue("operation_classification"),
    cargo_types: strings("cargo_types"),
    physical_address: stringValue("physical_address"),
    mailing_address: stringValue("mailing_address"),
    officials: Array.isArray(value.officials)
      ? (value.officials as Mcs150ProfileValues["officials"])
      : null,
  };
}

async function recordAttempt(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    attemptId: string;
    quarterKey: string;
    status: "started" | "succeeded" | "failed";
    reason: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    client_id: input.clientId,
    action_type: "mcs150_truth_up_check_attempt",
    entity_type: "mcs150_truth_up_check",
    entity_id: input.attemptId,
    description: `MCS-150 truth-up check ${input.status}: ${input.reason}`,
    metadata: {
      attempt_id: input.attemptId,
      quarter_key: input.quarterKey,
      status: input.status,
      reason: input.reason,
      ...input.metadata,
    },
  });
  if (error) {
    throw dbError(
      `Unable to log MCS-150 check ${input.status}`,
      error,
    );
  }
}

async function reconcileOpenUpdates(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    census: Mcs150ProfileValues | null;
    freshMcs150Date: string | null;
    now: Date;
  },
): Promise<Mcs150ReconciliationResult> {
  const result: Mcs150ReconciliationResult = {
    checked: 0,
    confirmedUpdateIds: [],
    fulfilledRequestIds: [],
    waitingForFreshFields: [],
  };
  if (!input.census) return result;

  const { data, error } = await supabase
    .from("mcs150_updates")
    .select(
      "id, client_request_id, proposed_changes, census_snapshot, submitted_date",
    )
    .eq("client_id", input.clientId)
    .eq("status", "submitted")
    .order("created_at", { ascending: true });
  if (error) throw dbError("Unable to load open MCS-150 updates", error);

  for (const row of (data ?? []) as OpenUpdateRow[]) {
    result.checked += 1;
    const proposed = parseProposedChanges(row.proposed_changes ?? {});
    const missingFields = requiredFreshFields(input.census, proposed);
    const baselineMcs150Date =
      typeof row.census_snapshot?.mcs150_date === "string"
        ? row.census_snapshot.mcs150_date
        : null;
    const filingDateAdvanced =
      input.freshMcs150Date !== null &&
      baselineMcs150Date !== null &&
      input.freshMcs150Date > baselineMcs150Date &&
      (row.submitted_date === null ||
        input.freshMcs150Date >= row.submitted_date);
    if (!filingDateAdvanced) {
      missingFields.push("newer_mcs150_filing_date");
    }
    if (missingFields.length > 0) {
      result.waitingForFreshFields.push({
        updateId: row.id,
        fields: missingFields,
      });
      continue;
    }

    const comparison = compareMcs150Profiles({
      census: input.census,
      attested: proposed,
      asOf: pacificDate(input.now),
    });
    if (comparison.shouldTrigger) {
      const { error: checkedError } = await supabase
        .from("mcs150_updates")
        .update({
          last_checked_at: input.now.toISOString(),
          updated_at: input.now.toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "submitted");
      if (checkedError) {
        throw dbError(
          `Unable to stamp open MCS-150 update ${row.id}`,
          checkedError,
        );
      }
      continue;
    }

    const { data: confirmedRows, error: confirmationError } =
      await supabase.rpc("confirm_mcs150_update_v1", {
        p_client_id: input.clientId,
        p_update_id: row.id,
        p_confirmed_date: pacificDate(input.now),
        p_confirmed_census_snapshot: input.census,
        p_checked_at: input.now.toISOString(),
      });
    if (confirmationError) {
      throw dbError(
        `Unable to atomically confirm MCS-150 update ${row.id}`,
        confirmationError,
      );
    }
    const confirmed = confirmedRows?.[0];
    if (!confirmed || confirmed.status !== "confirmed") {
      throw new Error(
        `Atomic confirmation returned no confirmed row for MCS-150 update ${row.id}`,
      );
    }
    if (confirmed.client_request_id) {
      result.fulfilledRequestIds.push(confirmed.client_request_id);
    }
    result.confirmedUpdateIds.push(row.id);
  }

  return result;
}

async function alreadyCheckedThisQuarter(
  supabase: SupabaseClient,
  clientId: string,
  quarterKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id")
    .eq("client_id", clientId)
    .eq("action_type", "mcs150_truth_up_check_attempt")
    .filter("metadata->>quarter_key", "eq", quarterKey)
    .filter("metadata->>status", "eq", "succeeded")
    .limit(1);
  if (error) throw dbError("Unable to inspect the quarterly MCS-150 gate", error);
  return (data?.length ?? 0) > 0;
}

async function alreadyHandledDueWindow(
  supabase: SupabaseClient,
  clientId: string,
  dueDate: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id")
    .eq("client_id", clientId)
    .eq("action_type", "mcs150_truth_up_check_attempt")
    .filter("metadata->>status", "eq", "succeeded")
    .filter("metadata->>due_window_active", "eq", "true")
    .filter("metadata->>due_date", "eq", dueDate)
    .limit(1);
  if (error) {
    throw dbError("Unable to inspect the MCS-150 due-window gate", error);
  }
  return (data?.length ?? 0) > 0;
}

export function buildMcs150RequestDescription(
  evaluation: Mcs150TruthUpEvaluation,
): string {
  const reasons = evaluation.triggerReasons
    .map((reason) => `- ${reason.message}`)
    .join("\n");
  return [
    "SafeScore's public census check found an MCS-150 truth-up item:",
    reasons,
    "",
    "Please confirm the carrier's current power units and drivers, and provide current IRP/IFTA mileage support plus an equipment schedule. Confirm operation classification, cargo, physical and mailing addresses, and company officials where applicable.",
    "",
    evaluation.honestyPrediction.summary,
    "",
    "SafeScore prepares the comparison and proposed figures. The carrier must attest to their accuracy and submit the MCS-150 through its own Login.gov account. SafeScore does not file the form.",
  ].join("\n");
}

async function createOrLoadArtifacts(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    clientName: string;
    evaluation: Mcs150TruthUpEvaluation;
    census: Mcs150ProfileValues;
    attested: Mcs150ProfileValues;
    freshCensus: SAFERSnapshot;
    now: Date;
  },
): Promise<{ updateId: string; requestId: string; artifactsCreated: boolean }> {
  const proposedChanges = comparableMcs150Proposal(
    input.census,
    input.attested,
  );
  let updateId: string | null = null;
  let artifactsCreated = false;
  const censusSnapshot = {
    ...input.census,
    mcs150_date: input.freshCensus.mcs150Date,
    safer_as_of: input.freshCensus.saferAsOf,
    observed_at: input.now.toISOString(),
  };
  const existingActive = await supabase
    .from("mcs150_updates")
    .select("id, status, client_request_id")
    .eq("client_id", input.clientId)
    .in("status", [...OPEN_UPDATE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingActive.error) {
    throw dbError(
      "Unable to inspect existing MCS-150 update drafts",
      existingActive.error,
    );
  }
  if (existingActive.data) {
    updateId = existingActive.data.id;
    if (existingActive.data.status === "submitted") {
      if (existingActive.data.client_request_id) {
        return {
          updateId: existingActive.data.id,
          requestId: existingActive.data.client_request_id,
          artifactsCreated: false,
        };
      }
    } else {
      const refreshed = await supabase
        .from("mcs150_updates")
        .update({
          proposed_changes: proposedChanges,
          trigger_key: input.evaluation.fingerprint,
          trigger_reasons: input.evaluation.triggerReasons,
          census_snapshot: censusSnapshot,
          attested_snapshot: input.attested,
          honesty_prediction: input.evaluation.honestyPrediction,
          biennial_due_date: input.evaluation.clock.nextDueDate,
          last_checked_at: input.now.toISOString(),
          updated_at: input.now.toISOString(),
        })
        .eq("id", existingActive.data.id)
        .eq("client_id", input.clientId)
        .in("status", ["draft", "pending_review"])
        .select("id")
        .maybeSingle();
      if (refreshed.error || !refreshed.data) {
        throw new Error(
          `Unable to refresh the existing MCS-150 update draft: ${
            refreshed.error?.message ?? "No editable draft returned"
          }`,
        );
      }
      updateId = refreshed.data.id;
    }
  } else {
    const insertResult = await supabase
      .from("mcs150_updates")
      .insert({
        client_id: input.clientId,
        status: "draft",
        proposed_changes: proposedChanges,
        notes:
          "Prepared from the carrier-attested profile. Carrier review, attestation, and Login.gov submission are required.",
        trigger_key: input.evaluation.fingerprint,
        trigger_reasons: input.evaluation.triggerReasons,
        census_snapshot: censusSnapshot,
        attested_snapshot: input.attested,
        honesty_prediction: input.evaluation.honestyPrediction,
        biennial_due_date: input.evaluation.clock.nextDueDate,
        last_checked_at: input.now.toISOString(),
        updated_at: input.now.toISOString(),
      })
      .select("id")
      .single();
    if (insertResult.error?.code === "23505") {
      const existing = await supabase
        .from("mcs150_updates")
        .select("id")
        .eq("client_id", input.clientId)
        .in("status", [...OPEN_UPDATE_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (existing.error) {
        throw dbError(
          "Unable to recover the existing MCS-150 update",
          existing.error,
        );
      }
      updateId = existing.data.id;
    } else if (insertResult.error) {
      throw dbError(
        "Unable to create the MCS-150 update draft",
        insertResult.error,
      );
    } else {
      updateId = insertResult.data.id;
      artifactsCreated = true;
    }
  }
  if (!updateId) {
    throw new Error("The MCS-150 update could not be identified after creation.");
  }

  const dedupeKey = `${input.clientId}:mcs150:${updateId}`;
  const existingRequest = await supabase
    .from("client_requests")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existingRequest.error) {
    throw dbError(
      "Unable to inspect the existing MCS-150 client request",
      existingRequest.error,
    );
  }
  const today = new Date(`${pacificDate(input.now)}T00:00:00.000Z`);
  const responseDue = new Date(today);
  responseDue.setUTCDate(responseDue.getUTCDate() + 14);
  const biennialDue = new Date(
    `${input.evaluation.clock.nextDueDate}T00:00:00.000Z`,
  );
  const dueDate =
    input.evaluation.deltas.length > 0 &&
    responseDue.getTime() < biennialDue.getTime()
      ? responseDue
      : biennialDue.getTime() < today.getTime()
        ? today
        : biennialDue;
  const requestResult = await supabase
    .from("client_requests")
    .upsert(
      {
        client_id: input.clientId,
        dedupe_key: dedupeKey,
        category: "mcs150_truth_up",
        title: `MCS-150 truth-up needed for ${input.clientName}`,
        description: buildMcs150RequestDescription(input.evaluation),
        source: "standing",
        responsibility: "client",
        case_type: null,
        case_id: null,
        requested_items: [],
        status: "open",
        due_at: `${dueDate.toISOString().slice(0, 10)}T23:59:59.000Z`,
        reminder_count: 0,
        next_reminder_at: null,
        escalated_at: null,
        closed_at: null,
        updated_at: input.now.toISOString(),
      },
      { onConflict: "dedupe_key" },
    )
    .select("id")
    .single();
  if (requestResult.error) {
    throw dbError("Unable to create the MCS-150 client request", requestResult.error);
  }
  artifactsCreated = artifactsCreated || !existingRequest.data;

  const { error: linkError } = await supabase
    .from("mcs150_updates")
    .update({
      client_request_id: requestResult.data.id,
      last_checked_at: input.now.toISOString(),
      updated_at: input.now.toISOString(),
    })
    .eq("id", updateId)
    .eq("client_id", input.clientId);
  if (linkError) throw dbError("Unable to link the MCS-150 request", linkError);

  return {
    updateId,
    requestId: requestResult.data.id,
    artifactsCreated,
  };
}

export async function runMcs150TruthUp(
  input: RunMcs150TruthUpInput,
  supabase: SupabaseClient,
): Promise<Mcs150TruthUpRunResult> {
  const now = input.now ?? new Date();
  const quarterKey = mcs150QuarterKey(now);
  if (!input.complianceIncluded) {
    return {
      reconciliation: {
        checked: 0,
        confirmedUpdateIds: [],
        fulfilledRequestIds: [],
        waitingForFreshFields: [],
      },
      quarterly: {
        status: "skipped_not_in_tier",
        quarterKey,
        reason: "compliance_layer_not_included",
        evaluation: null,
        updateId: null,
        requestId: null,
        artifactsCreated: false,
      },
    };
  }

  const census = input.freshCensus
    ? mcs150CensusValues(input.freshCensus)
    : null;
  const reconciliation = await reconcileOpenUpdates(supabase, {
    clientId: input.clientId,
    census,
    freshMcs150Date: input.freshCensus?.mcs150Date ?? null,
    now,
  });

  const quarterAlreadyChecked = await alreadyCheckedThisQuarter(
    supabase,
    input.clientId,
    quarterKey,
  );
  const currentClock = input.freshCensus
    ? computeMcs150BiennialClock({
        dotNumber: input.dotNumber,
        lastFiledDate: input.freshCensus.mcs150Date,
        asOf: now,
      })
    : null;
  const dueWindowAlreadyHandled =
    currentClock?.dueWithin60Days === true
      ? await alreadyHandledDueWindow(
          supabase,
          input.clientId,
          currentClock.nextDueDate,
        )
      : false;
  const shouldRunScheduledCheck = shouldRunMcs150ScheduledCheck({
    quarterAlreadyChecked,
    dueWithin60Days: currentClock?.dueWithin60Days ?? false,
    dueWindowAlreadyHandled,
  });
  const dueWindowNeedsCheck =
    shouldRunScheduledCheck && quarterAlreadyChecked;
  if (!shouldRunScheduledCheck) {
    return {
      reconciliation,
      quarterly: {
        status: "skipped_already_checked",
        quarterKey,
        reason: "quarter_already_succeeded",
        evaluation: null,
        updateId: null,
        requestId: null,
        artifactsCreated: false,
      },
    };
  }

  const attemptId = randomUUID();
  await recordAttempt(supabase, {
    clientId: input.clientId,
    attemptId,
    quarterKey,
    status: "started",
    reason: dueWindowNeedsCheck
      ? "due_window_crossing_check_started"
      : "quarterly_comparison_started",
  });

  try {
    if (!input.freshCensus || !census) {
      throw new Error(
        "Fresh SAFER census data was unavailable; no MCS-150 artifact was created or closed.",
      );
    }

    const profileResult = await supabase
      .from("client_attested_profiles")
      .select(
        "id, power_units, drivers, annual_mileage, mileage_year, operation_classification, cargo_types, physical_address, mailing_address, officials, source, attested_at",
      )
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (profileResult.error) {
      throw dbError("Unable to load the attested operating profile", profileResult.error);
    }
    let attestedData = profileResult.data as AttestedProfileRow | null;
    if (!attestedData) {
      const initialized = await supabase
        .from("client_attested_profiles")
        .insert({
          client_id: input.clientId,
          power_units: census.power_units,
          drivers: census.drivers,
          annual_mileage: census.annual_mileage,
          mileage_year: census.mileage_year,
          operation_classification:
            census.operation_classification ?? null,
          cargo_types: census.cargo_types ?? [],
          physical_address: census.physical_address ?? null,
          mailing_address: census.mailing_address ?? null,
          officials: census.officials ?? [],
          source: "census_default",
          attested_at: null,
          attested_by: null,
        })
        .select(
          "id, power_units, drivers, annual_mileage, mileage_year, operation_classification, cargo_types, physical_address, mailing_address, officials, source, attested_at",
        )
        .single();
      if (initialized.error?.code === "23505") {
        const concurrent = await supabase
          .from("client_attested_profiles")
          .select(
            "id, power_units, drivers, annual_mileage, mileage_year, operation_classification, cargo_types, physical_address, mailing_address, officials, source, attested_at",
          )
          .eq("client_id", input.clientId)
          .single();
        if (concurrent.error) {
          throw dbError(
            "Unable to load the concurrently initialized operating profile",
            concurrent.error,
          );
        }
        attestedData = concurrent.data as AttestedProfileRow;
      } else if (initialized.error) {
        throw dbError(
          "Unable to initialize the census-default operating profile",
          initialized.error,
        );
      } else {
        attestedData = initialized.data as AttestedProfileRow;
        const { error: initializationLogError } = await supabase
          .from("activity_log")
          .insert({
            client_id: input.clientId,
            action_type: "mcs150_attested_profile_initialized",
            entity_type: "client_attested_profiles",
            entity_id: attestedData.id,
            description:
              "MCS-150 comparison values were initialized from the fresh public census by the scheduled truth-up check.",
            metadata: {
              source: "census_default",
              operator_attested: false,
              initialization_path: "quarterly_check",
            },
          });
        if (initializationLogError) {
          throw dbError(
            "Unable to log census-default profile initialization",
            initializationLogError,
          );
        }
      }
    }
    let attestedRow = attestedData;
    if (attestedRow.source === "census_default") {
      const { data: synced, error: syncError } = await supabase
        .from("client_attested_profiles")
        .update({
          power_units: census.power_units,
          drivers: census.drivers,
          annual_mileage: census.annual_mileage,
          mileage_year: census.mileage_year,
          operation_classification:
            census.operation_classification ?? null,
          cargo_types: census.cargo_types ?? [],
          physical_address: census.physical_address ?? null,
          mailing_address: census.mailing_address ?? null,
          officials: census.officials ?? [],
          updated_at: now.toISOString(),
        })
        .eq("id", attestedRow.id)
        .eq("client_id", input.clientId)
        .eq("source", "census_default")
        .select(
          "id, power_units, drivers, annual_mileage, mileage_year, operation_classification, cargo_types, physical_address, mailing_address, officials, source, attested_at",
        )
        .single();
      if (syncError) {
        throw dbError(
          "Unable to synchronize the census-default operating profile",
          syncError,
        );
      }
      attestedRow = synced as AttestedProfileRow;
    }
    const attested = attestedValues(attestedRow);
    const evaluation = evaluateMcs150TruthUp({
      dotNumber: input.dotNumber,
      lastFiledDate: input.freshCensus.mcs150Date,
      census,
      attested,
      burdenPoints: input.burdenPoints,
      asOf: pacificDate(now),
    });

    let updateId: string | null = null;
    let requestId: string | null = null;
    let artifactsCreated = false;
    if (evaluation.shouldTrigger) {
      const artifacts = await createOrLoadArtifacts(supabase, {
        clientId: input.clientId,
        clientName: input.clientName,
        evaluation,
        census,
        attested,
        freshCensus: input.freshCensus,
        now,
      });
      updateId = artifacts.updateId;
      requestId = artifacts.requestId;
      artifactsCreated = artifacts.artifactsCreated;
    }

    const reason = evaluation.shouldTrigger
      ? "comparison_succeeded_artifacts_ready"
      : "comparison_succeeded_no_trigger";
    await recordAttempt(supabase, {
      clientId: input.clientId,
      attemptId,
      quarterKey,
      status: "succeeded",
      reason,
      metadata: {
        evaluation,
        update_id: updateId,
        client_request_id: requestId,
        attested_profile_source: attestedRow.source,
        due_window_active: evaluation.dueWithin60Days,
        due_date: evaluation.clock.nextDueDate,
      },
    });
    return {
      reconciliation,
      quarterly: {
        status: "succeeded",
        quarterKey,
        reason,
        evaluation,
        updateId,
        requestId,
        artifactsCreated,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAttempt(supabase, {
      clientId: input.clientId,
      attemptId,
      quarterKey,
      status: "failed",
      reason: message,
    });
    return {
      reconciliation,
      quarterly: {
        status: "failed",
        quarterKey,
        reason: message,
        evaluation: null,
        updateId: null,
        requestId: null,
        artifactsCreated: false,
      },
    };
  }
}
