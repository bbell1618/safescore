import { humanEnteredNameOrEmpty } from "@/lib/onboarding/validation";

export type OnboardingCompletenessRecord = {
  primary_contact?: unknown;
  phone?: unknown;
  vehicle_types?: unknown;
  operating_states?: unknown;
  operating_radius?: unknown;
  driver_count?: unknown;
  citation_dismissed_last_24_months?: unknown;
  service_agreement_accepted?: unknown;
};

export function missingOnboardingProfileFields(
  record: OnboardingCompletenessRecord
): string[] {
  const missing: string[] = [];
  if (!humanEnteredNameOrEmpty(record.primary_contact)) {
    missing.push("primary contact name");
  }
  if (typeof record.phone !== "string" || !record.phone.trim()) {
    missing.push("contact phone");
  }
  if (!Array.isArray(record.vehicle_types) || record.vehicle_types.length === 0) {
    missing.push("vehicle types");
  }
  if (!Array.isArray(record.operating_states) || record.operating_states.length === 0) {
    missing.push("operating states");
  }
  if (
    typeof record.operating_radius !== "string" ||
    !record.operating_radius.trim()
  ) {
    missing.push("operating radius");
  }
  if (
    typeof record.driver_count !== "number" ||
    !Number.isInteger(record.driver_count) ||
    record.driver_count < 1
  ) {
    missing.push("billing driver count");
  }
  if (typeof record.citation_dismissed_last_24_months !== "boolean") {
    missing.push("roadside-ticket answer");
  }
  if (record.service_agreement_accepted !== true) {
    missing.push("service agreement");
  }
  return missing;
}
