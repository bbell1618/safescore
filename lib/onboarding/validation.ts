import type { ClientTier } from "@/lib/supabase/types";

export const ONBOARDING_PLACEHOLDER_NAMES = new Set([
  "pending onboarding",
  "pending invite",
  "invite pending",
  "onboarding contact pending",
  "to be provided",
  "tbd",
]);

export function humanEnteredNameOrEmpty(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return ONBOARDING_PLACEHOLDER_NAMES.has(trimmed.toLowerCase()) ? "" : trimmed;
}

export function parseRequiredDriverCount(value: string | number): number | null {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 10_000
    ? parsed
    : null;
}

export type OnboardingField =
  | "client"
  | "contactName"
  | "contactPhone"
  | "vehicleTypes"
  | "operatingRadius"
  | "operatingStates"
  | "driverCount"
  | "citationDismissedLast24Months"
  | "agreementChecked"
  | "dataAccessChecked"
  | "dataqChecked";

export type OnboardingValidation = {
  valid: boolean;
  errors: Partial<Record<OnboardingField, string>>;
  missing: string[];
  summary: string | null;
};

function naturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function result(
  entries: Array<[OnboardingField, string, string] | null>
): OnboardingValidation {
  const present = entries.filter(
    (entry): entry is [OnboardingField, string, string] => entry !== null
  );
  const errors = Object.fromEntries(
    present.map(([field, message]) => [field, message])
  ) as Partial<Record<OnboardingField, string>>;
  const missing = present.map(([, , label]) => label);
  return {
    valid: missing.length === 0,
    errors,
    missing,
    summary:
      missing.length > 0 ? `Still needed: ${naturalList(missing)}.` : null,
  };
}

export function validateOnboardingStep1(input: {
  clientReady: boolean;
  contactName: string;
  contactPhone: string;
}): OnboardingValidation {
  return result([
    input.clientReady
      ? null
      : ["client", "Wait for your carrier account to finish loading.", "carrier account"],
    input.contactName.trim()
      ? null
      : ["contactName", "Enter your full name.", "full name"],
    input.contactPhone.trim()
      ? null
      : ["contactPhone", "Enter a phone number.", "phone number"],
  ]);
}

export function validateOnboardingStep2(input: {
  vehicleTypes: string[];
  operatingStates: string[];
  operatingRadius: string;
  driverCount: string | number;
  citationDismissedLast24Months: boolean | null;
}): OnboardingValidation {
  return result([
    input.vehicleTypes.length > 0
      ? null
      : [
          "vehicleTypes",
          "Choose at least one equipment type.",
          "equipment type",
        ],
    input.operatingRadius
      ? null
      : [
          "operatingRadius",
          "Choose an operating radius.",
          "operating radius",
        ],
    input.operatingStates.length > 0
      ? null
      : [
          "operatingStates",
          "Choose at least one state of operation.",
          "state of operation",
        ],
    parseRequiredDriverCount(input.driverCount) !== null
      ? null
      : [
          "driverCount",
          "Enter a whole-number driver count of at least 1.",
          "billing driver count of at least 1",
        ],
    input.citationDismissedLast24Months !== null
      ? null
      : [
          "citationDismissedLast24Months",
          "Choose yes or no.",
          "roadside-ticket answer",
        ],
  ]);
}

export function validateOnboardingStep3(input: {
  agreementChecked: boolean;
  dataAccessChecked: boolean;
  dataqChecked: boolean;
  tier: ClientTier | null;
}): OnboardingValidation {
  const needsCaseAuthorization =
    input.tier === "remediate" || input.tier === "total_safety";
  return result([
    input.agreementChecked
      ? null
      : [
          "agreementChecked",
          "Accept the service agreement.",
          "service agreement",
        ],
    input.dataAccessChecked
      ? null
      : [
          "dataAccessChecked",
          "Authorize FMCSA data access.",
          "FMCSA data authorization",
        ],
    !needsCaseAuthorization || input.dataqChecked
      ? null
      : [
          "dataqChecked",
          "Authorize managed DataQ and CPDP filing.",
          "filing authorization",
        ],
  ]);
}
