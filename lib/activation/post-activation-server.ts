import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runChallengeabilityAssessment,
  type ChallengeabilityRunResult,
} from "@/lib/analysis/challengeability-assessment-server";
import {
  sendOperationsNotification,
  sendSafeScoreLiveEmail,
  type EmailDeliveryResult,
} from "@/lib/email/client";
import { runClientRefresh } from "@/lib/monitoring/run-client-refresh";
import {
  captureBurdenSnapshot,
  type BurdenSnapshotResult,
} from "@/lib/monitoring/snapshot";
import type { ClientTier } from "@/lib/supabase/types";
import { tierDisplayLabel, tierHasFeature } from "@/lib/tiers";

export type ActivationInitializationSource =
  | "staff_activation"
  | "billing_sync"
  | "stripe_webhook";

type ClaimRow = {
  claimed: boolean;
  result_status:
    | "not_enqueued"
    | "pending"
    | "running"
    | "succeeded"
    | "failed";
  result_claim_token: string | null;
  result_attempt_count: number;
};

type ChallengeabilitySummary = {
  included: boolean;
  batches: number;
  requested: number;
  assessed: number;
  challengeable: number;
};

type CompletedInitialization = {
  status: "succeeded";
  attemptCount: number;
  snapshot: BurdenSnapshotResult;
  publicAnalysis: {
    inspectionsPulled: number;
    violationsProcessed: number;
    crashesPulled: number;
    newInspectionCount: number;
    newViolationCount: number;
    newCrashCount: number;
  };
  challengeability: ChallengeabilitySummary;
  clientEmailDelivery: EmailDeliveryResult;
  staffEmailDelivery: EmailDeliveryResult;
};

export type ActivationInitializationResult =
  | CompletedInitialization
  | {
      status: "already_succeeded" | "in_progress" | "not_required";
      attemptCount: number;
    };

const MAX_CHALLENGEABILITY_BATCHES = 100;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required for activation notification links"
    );
  }
  return value;
}

function emailDeliveryMetadata(result: EmailDeliveryResult) {
  return {
    status: result.success
      ? result.dryRun
        ? "dry_run"
        : "sent"
      : "failed",
    dry_run: result.dryRun === true,
    message_id: result.messageId ?? null,
    reason: result.error ?? null,
  };
}

async function runTierChallengeability(
  service: SupabaseClient,
  clientId: string,
  tier: ClientTier
): Promise<ChallengeabilitySummary> {
  if (!tierHasFeature(tier, "case_visibility")) {
    return {
      included: false,
      batches: 0,
      requested: 0,
      assessed: 0,
      challengeable: 0,
    };
  }

  const summary: ChallengeabilitySummary = {
    included: true,
    batches: 0,
    requested: 0,
    assessed: 0,
    challengeable: 0,
  };

  for (let batch = 0; batch < MAX_CHALLENGEABILITY_BATCHES; batch += 1) {
    const result: ChallengeabilityRunResult =
      await runChallengeabilityAssessment(service, clientId);
    summary.batches += 1;
    summary.requested += result.requested;
    summary.assessed += result.assessed;
    summary.challengeable += result.challengeable;

    if (result.failures.length > 0) {
      throw new Error(
        `Challengeability initialization failed: ${result.failures
          .map((failure) => `${failure.violationId}: ${failure.error}`)
          .join(" | ")}`
      );
    }
    if (!result.hasMore) return summary;
    if (result.requested === 0) {
      throw new Error(
        "Challengeability initialization reported more work without returning a batch"
      );
    }
  }

  throw new Error(
    `Challengeability initialization exceeded ${MAX_CHALLENGEABILITY_BATCHES} batches`
  );
}

async function insertActivity(
  service: SupabaseClient,
  payload: Record<string, unknown>,
  label: string
) {
  const { data, error } = await service
    .from("activity_log")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `${label}: ${error?.message ?? "activity row was not inserted"}`
    );
  }
  return data.id as string;
}

/**
 * Completes the durable work that follows either activation RPC. The claim RPC
 * makes Stripe webhook/browser races one-at-a-time and permits retries after a
 * failed or stale run without repeating a completed initialization.
 */
export async function runPostActivationInitialization(
  service: SupabaseClient,
  input: {
    clientId: string;
    tier: ClientTier;
    source: ActivationInitializationSource;
    newlyActivated: boolean;
    actorUserId?: string | null;
  }
): Promise<ActivationInitializationResult> {
  const { data: claimData, error: claimError } = await service
    .rpc("claim_client_activation_initialization_v1", {
      p_client_id: input.clientId,
      p_tier: input.tier,
      p_source: input.source,
      p_create_if_missing: input.newlyActivated,
    })
    .single();
  if (claimError || !claimData) {
    throw new Error(
      `Unable to claim post-activation initialization: ${
        claimError?.message ?? "claim returned no row"
      }`
    );
  }

  const claim = claimData as ClaimRow;
  if (!claim.claimed) {
    return {
      status:
        claim.result_status === "succeeded"
          ? "already_succeeded"
          : claim.result_status === "not_enqueued"
            ? "not_required"
            : "in_progress",
      attemptCount: claim.result_attempt_count,
    };
  }
  if (!claim.result_claim_token) {
    throw new Error("Post-activation initialization claim omitted its token");
  }

  const claimToken = claim.result_claim_token;
  let publicAnalysis: CompletedInitialization["publicAnalysis"] | null = null;
  let snapshot: BurdenSnapshotResult | null = null;
  let challengeability: ChallengeabilitySummary | null = null;
  let clientEmailDelivery: EmailDeliveryResult | null = null;
  let staffEmailDelivery: EmailDeliveryResult | null = null;

  try {
    await insertActivity(
      service,
      {
        client_id: input.clientId,
        user_id: input.actorUserId ?? null,
        action_type: "client_activation_initialization_started",
        entity_type: "clients",
        entity_id: input.clientId,
        description: "First SafeScore analysis started after client activation",
        metadata: {
          activation_source: input.source,
          activation_tier: input.tier,
          attempt_count: claim.result_attempt_count,
        },
      },
      "Unable to log activation initialization start"
    );

    const [clientResult, portalUserResult] = await Promise.all([
      service
        .from("clients")
        .select("id, name, dot_number, tier, status, email")
        .eq("id", input.clientId)
        .single(),
      service
        .from("users")
        .select("email")
        .eq("client_id", input.clientId)
        .eq("role", "client_user")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (clientResult.error || !clientResult.data) {
      throw new Error(
        `Unable to load activated client: ${
          clientResult.error?.message ?? "client not found"
        }`
      );
    }
    if (portalUserResult.error) {
      throw new Error(
        `Unable to load activation email recipient: ${portalUserResult.error.message}`
      );
    }

    const client = clientResult.data as {
      id: string;
      name: string;
      dot_number: string;
      tier: ClientTier | null;
      status: string;
      email: string | null;
    };
    if (client.status !== "active") {
      throw new Error(
        `Post-activation initialization requires active status, found ${client.status}`
      );
    }
    if (client.tier !== input.tier) {
      throw new Error(
        `Post-activation tier changed from ${input.tier} to ${
          client.tier ?? "unassigned"
        }`
      );
    }
    const recipientEmail = portalUserResult.data?.email ?? client.email;
    if (!recipientEmail) {
      throw new Error("Activated client has no portal or account email recipient");
    }

    const refresh = await runClientRefresh(
      { clientId: client.id, dotNumber: client.dot_number },
      service
    );
    publicAnalysis = {
      inspectionsPulled: refresh.inspectionsPulled,
      violationsProcessed: refresh.violationsProcessed,
      crashesPulled: refresh.crashesPulled,
      newInspectionCount: refresh.newInspectionIds.length,
      newViolationCount: refresh.newViolationIds.length,
      newCrashCount: refresh.newCrashIds.length,
    };

    snapshot = await captureBurdenSnapshot(
      client.id,
      "activation_initial_analysis",
      service
    );
    challengeability = await runTierChallengeability(
      service,
      client.id,
      input.tier
    );

    const baseUrl = appBaseUrl();
    clientEmailDelivery = await sendSafeScoreLiveEmail({
      to: recipientEmail,
      companyName: client.name,
      dotNumber: client.dot_number,
      tierLabel: tierDisplayLabel(input.tier),
      portalUrl: `${baseUrl}/portal`,
    });
    if (!clientEmailDelivery.success) {
      throw new Error(
        `Client SafeScore-live notification failed: ${
          clientEmailDelivery.error ?? "unknown delivery failure"
        }`
      );
    }

    staffEmailDelivery = await sendOperationsNotification({
      trigger: "staff_client_activated",
      subject: `SafeScore activated — ${client.name} (DOT ${client.dot_number})`,
      heading: "Client activated and first analysis completed",
      message: `${client.name} is active in SafeScore. Its first public analysis${
        challengeability.included ? " and challengeability review" : ""
      } completed successfully.`,
      consoleUrl: `${baseUrl}/console/clients/${client.id}`,
      ctaLabel: "Open client file",
      details: [
        { label: "Company", value: client.name },
        { label: "USDOT", value: client.dot_number },
        { label: "Service", value: tierDisplayLabel(input.tier) },
        { label: "Activation path", value: input.source.replaceAll("_", " ") },
      ],
    });
    if (!staffEmailDelivery.success) {
      throw new Error(
        `Operations activation notification failed: ${
          staffEmailDelivery.error ?? "unknown delivery failure"
        }`
      );
    }

    const result: CompletedInitialization = {
      status: "succeeded",
      attemptCount: claim.result_attempt_count,
      snapshot,
      publicAnalysis,
      challengeability,
      clientEmailDelivery,
      staffEmailDelivery,
    };
    const completionMetadata = {
      activation_source: input.source,
      activation_tier: input.tier,
      attempt_count: claim.result_attempt_count,
      public_analysis: publicAnalysis,
      snapshot,
      challengeability,
      client_email_delivery: emailDeliveryMetadata(clientEmailDelivery),
      staff_email_delivery: emailDeliveryMetadata(staffEmailDelivery),
    };

    await insertActivity(
      service,
      {
        client_id: client.id,
        user_id: input.actorUserId ?? null,
        action_type: "client_activation_initialization_succeeded",
        entity_type: "clients",
        entity_id: client.id,
        description:
          "Client activation completed with first analysis and dry-run notifications",
        metadata: completionMetadata,
      },
      "Unable to log activation initialization success"
    );

    const { data: completed, error: completionError } = await service
      .from("client_activation_initializations")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        error: null,
        metadata: completionMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", client.id)
      .eq("claim_token", claimToken)
      .eq("status", "running")
      .select("client_id")
      .maybeSingle();
    if (completionError || !completed) {
      throw new Error(
        `Activation initialization lost its completion claim: ${
          completionError?.message ?? "row was not updated"
        }`
      );
    }

    return result;
  } catch (error) {
    const message = errorMessage(error);
    const failureMetadata = {
      activation_source: input.source,
      activation_tier: input.tier,
      attempt_count: claim.result_attempt_count,
      public_analysis: publicAnalysis,
      snapshot,
      challengeability,
      client_email_delivery: clientEmailDelivery
        ? emailDeliveryMetadata(clientEmailDelivery)
        : null,
      staff_email_delivery: staffEmailDelivery
        ? emailDeliveryMetadata(staffEmailDelivery)
        : null,
      failure_reason: message,
    };
    const now = new Date().toISOString();
    const { data: failed, error: ledgerError } = await service
      .from("client_activation_initializations")
      .update({
        status: "failed",
        completed_at: now,
        error: message,
        metadata: failureMetadata,
        updated_at: now,
      })
      .eq("client_id", input.clientId)
      .eq("claim_token", claimToken)
      .eq("status", "running")
      .select("client_id")
      .maybeSingle();

    let failureLogError: string | null = null;
    try {
      await insertActivity(
        service,
        {
          client_id: input.clientId,
          user_id: input.actorUserId ?? null,
          action_type: "client_activation_initialization_failed",
          entity_type: "clients",
          entity_id: input.clientId,
          description: `Client activation initialization failed: ${message}`,
          metadata: failureMetadata,
        },
        "Unable to log activation initialization failure"
      );
    } catch (logError) {
      failureLogError = errorMessage(logError);
    }

    const recordingErrors = [
      ledgerError || !failed
        ? `ledger: ${ledgerError?.message ?? "claim row was not updated"}`
        : null,
      failureLogError ? `activity: ${failureLogError}` : null,
    ].filter((value): value is string => Boolean(value));
    throw new Error(
      `${message}${
        recordingErrors.length > 0
          ? `. Failure recording also failed (${recordingErrors.join("; ")})`
          : ""
      }`
    );
  }
}
