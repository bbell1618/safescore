export const STAFF_TEST_RECIPIENTS = [
  "brandonbell@goldenerainsurance.com",
  "operations@goldenerainsurance.com",
] as const;

export function isStaffTestRecipient(value: unknown): value is typeof STAFF_TEST_RECIPIENTS[number] {
  return typeof value === "string" && STAFF_TEST_RECIPIENTS.some(recipient => recipient === value);
}
