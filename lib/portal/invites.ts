import { isClientTier } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

export type InviteEmailStatus = "sent" | "dry_run" | "failed";

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInviteEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidInviteEmail(value: string): boolean {
  return value.length <= 320 && SIMPLE_EMAIL_PATTERN.test(value);
}

export function resolveInviteEmailStatus({
  dryRun,
  deliverySucceeded,
}: {
  dryRun: boolean;
  deliverySucceeded: boolean;
}): InviteEmailStatus {
  if (dryRun) return "dry_run";
  return deliverySucceeded ? "sent" : "failed";
}

/** Invite creation must preserve the tier GEIA actually assigned. */
export function resolveAssignedInviteTier(value: unknown): ClientTier | null {
  return isClientTier(value) ? value : null;
}
