import assert from "node:assert/strict";
import {
  DQF_CHECKLIST_ITEMS,
  buildComplianceHealth,
  complianceDocumentExpiryStatus,
  complianceStatusForDays,
  complianceStatusLabel,
  complianceThresholdForDays,
  daysUntilDate,
  deriveAnnualDueDate,
} from "../lib/compliance/health";

const thresholdCases = [
  [61, null],
  [60, "60_day"],
  [31, "60_day"],
  [30, "30_day"],
  [8, "30_day"],
  [7, "7_day"],
  [1, "7_day"],
  [0, "expired"],
  [-1, "expired"],
] as const;

for (const [days, expected] of thresholdCases) {
  assert.equal(complianceThresholdForDays(days), expected, `threshold at ${days}`);
}

assert.equal(complianceStatusForDays(null, false), "missing");
assert.equal(complianceStatusForDays(null, true), "on_file");
assert.equal(complianceStatusForDays(61), "on_file");
assert.equal(complianceStatusForDays(60), "expiring");
assert.equal(complianceStatusForDays(1), "expiring");
assert.equal(complianceStatusForDays(0), "expired");
assert.equal(complianceStatusForDays(-1), "expired");
assert.equal(complianceStatusLabel("on_file"), "On file");
assert.equal(complianceDocumentExpiryStatus(null, "2026-08-04"), "missing");
assert.equal(
  complianceDocumentExpiryStatus("2026-08-04", "2026-08-04"),
  "expired"
);
assert.equal(
  complianceDocumentExpiryStatus("2026-09-03", "2026-08-04"),
  "expiring_soon"
);
assert.equal(
  complianceDocumentExpiryStatus("2026-12-31", "2026-08-04"),
  "current"
);

assert.equal(deriveAnnualDueDate("2026-08-04"), "2027-08-04");
assert.equal(deriveAnnualDueDate("2024-02-29"), "2025-02-28");
assert.equal(deriveAnnualDueDate(null), null);
assert.equal(daysUntilDate("2026-10-03", "2026-08-04"), 60);
assert.equal(daysUntilDate("2026-08-03", "2026-08-04"), -1);

assert.deepEqual(
  DQF_CHECKLIST_ITEMS.map((item) => item.docType),
  [
    "application",
    "prior_employer_checks",
    "road_test",
    "mvr",
    "annual_mvr_review",
    "medical_cert",
    "clearinghouse_pre_employment",
  ]
);

const standardDocuments = DQF_CHECKLIST_ITEMS.map((item, index) => ({
  id: `doc-${index}`,
  driver_id: "driver-active",
  doc_type: item.docType,
  status: "current" as const,
  completed_date:
    item.docType === "annual_mvr_review" ? "2025-08-04" : "2026-01-01",
  expiry_date: null,
  document_id: `file-${index}`,
}));

const health = buildComplianceHealth({
  asOfDate: "2026-08-04",
  drivers: [
    {
      id: "driver-active",
      full_name: "Test Active Driver",
      status: "active",
      cdl_expiry: "2026-10-03",
      medical_cert_expiry: "2026-08-11",
      approved_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "driver-missing",
      full_name: "Test Missing Driver",
      status: "active",
      cdl_expiry: null,
      medical_cert_expiry: null,
      approved_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "driver-terminated",
      full_name: "Test Terminated Driver",
      status: "terminated",
      cdl_expiry: "2020-01-01",
      medical_cert_expiry: "2020-01-01",
      approved_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "driver-pending",
      full_name: "Pending Client Submission",
      status: "active",
      cdl_expiry: "2026-08-05",
      medical_cert_expiry: "2026-08-05",
      approved_at: null,
    },
  ],
  driverDocuments: standardDocuments,
  vehicles: [
    {
      id: "vehicle-active",
      unit_number: "RUN-B-1",
      status: "active",
      annual_inspection_date: "2025-09-03",
    },
    {
      id: "vehicle-inactive",
      unit_number: "RUN-B-OLD",
      status: "inactive",
      annual_inspection_date: "2020-01-01",
    },
  ],
  clearinghouseRecords: [
    {
      id: "query-1",
      driver_id: "driver-active",
      query_date: "2025-08-05",
    },
  ],
});

assert.equal(
  health.drivers.total,
  2,
  "terminated and unapproved client-submitted drivers are excluded"
);
assert.ok(
  health.upcoming.every((item) => item.driverId !== "driver-pending"),
  "pending client submissions cannot create expiration work"
);
assert.equal(health.drivers.expired, 1);
assert.equal(health.drivers.missing, 1);
assert.equal(health.vehicles.total, 1, "inactive vehicles are excluded");
assert.equal(health.vehicles.expiring, 1);
assert.equal(health.vehicles.items[0]?.annualInspectionDueDate, "2026-09-03");
assert.ok(
  health.upcoming.some(
    (item) => item.itemType === "cdl" && item.daysRemaining === 60
  )
);
assert.ok(
  health.upcoming.some(
    (item) => item.itemType === "medical_certificate" && item.daysRemaining === 7
  )
);
assert.ok(
  health.upcoming.some(
    (item) =>
      item.itemType === "clearinghouse_annual_query" && item.daysRemaining === 1
  )
);
assert.ok(
  health.upcoming.some(
    (item) =>
      item.itemType === "annual_mvr_review" && item.daysRemaining === 0
  )
);

const missingAnnualReviewDate = buildComplianceHealth({
  asOfDate: "2026-08-04",
  drivers: [
    {
      id: "driver-date-missing",
      full_name: "Missing Review Date",
      status: "active",
      cdl_expiry: "2027-08-04",
      medical_cert_expiry: "2027-08-04",
      approved_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  driverDocuments: DQF_CHECKLIST_ITEMS.map((item, index) => ({
    id: `missing-date-doc-${index}`,
    driver_id: "driver-date-missing",
    doc_type: item.docType,
    status: "current",
    completed_date: item.docType === "annual_mvr_review" ? null : "2026-01-01",
    expiry_date: null,
    document_id: `missing-date-file-${index}`,
  })),
  vehicles: [],
  clearinghouseRecords: [
    {
      id: "query-current",
      driver_id: "driver-date-missing",
      query_date: "2026-08-04",
    },
  ],
});

const annualReview = missingAnnualReviewDate.drivers.items[0]?.dqfItems.find(
  (item) => item.docType === "annual_mvr_review"
);
assert.equal(annualReview?.status, "missing");
assert.equal(missingAnnualReviewDate.drivers.items[0]?.overallStatus, "missing");

console.log(
  JSON.stringify(
    {
      thresholds: thresholdCases,
      dqfTypes: DQF_CHECKLIST_ITEMS.map((item) => item.docType),
      driverCounts: {
        total: health.drivers.total,
        expired: health.drivers.expired,
        missing: health.drivers.missing,
      },
      vehicleCounts: {
        total: health.vehicles.total,
        expiring: health.vehicles.expiring,
      },
      upcoming: health.upcoming.map((item) => ({
        type: item.itemType,
        days: item.daysRemaining,
        threshold: item.threshold,
      })),
      annualReviewWithoutDate: annualReview?.status,
    },
    null,
    2
  )
);
