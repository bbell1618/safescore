import assert from "node:assert/strict";

import { computeMcs150BiennialClock } from "../lib/mcs150/biennial";
import {
  buildMcs150HonestyPrediction,
  compareMcs150Profiles,
  evaluateMcs150TruthUp,
  shouldRunMcs150ScheduledCheck,
  type Mcs150ProfileValues,
} from "../lib/mcs150/truth-up";

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
  assertions += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

const nationwide: Mcs150ProfileValues = {
  power_units: 40,
  drivers: 45,
  annual_mileage: 1_417_456,
  mileage_year: 2025,
  operation_classification: "Interstate",
  cargo_types: ["Hazmat Products"],
  physical_address: "380 Clarence Bromell Ct, Tracy, CA 95377",
  mailing_address: null,
  officials: null,
};

const nationwideClock = computeMcs150BiennialClock({
  dotNumber: "2533650",
  lastFiledDate: "2026-05-08",
  asOf: "2026-07-24",
});
equal(nationwideClock.dueMonth, 10, "USDOT final 0 maps to October");
equal(
  nationwideClock.dueYearParity,
  "odd",
  "USDOT next-to-last 5 maps to odd filing years",
);
equal(
  nationwideClock.satisfiedCycleDueDate,
  "2025-10-31",
  "late filing cures the prior cycle",
);
equal(
  nationwideClock.nextDueDate,
  "2027-10-31",
  "Nationwide next deadline is October 31, 2027",
);
equal(nationwideClock.daysRemaining, 464, "Nationwide clock uses UTC date days");
equal(
  nationwideClock.dueWithin60Days,
  false,
  "Nationwide is outside the 60-day due window",
);

const januaryEven = computeMcs150BiennialClock({
  dotNumber: "481",
  lastFiledDate: "2024-01-10",
  asOf: "2025-01-01",
});
equal(januaryEven.dueMonth, 1, "Final digit 1 maps to January");
equal(januaryEven.dueYearParity, "even", "Next-to-last 8 maps to even");
equal(januaryEven.nextDueDate, "2026-01-31", "Even-year January deadline");

const septemberOdd = computeMcs150BiennialClock({
  dotNumber: "179",
  lastFiledDate: "2025-01-01",
  asOf: "2026-01-01",
});
equal(septemberOdd.dueMonth, 9, "Final digit 9 maps to September");
equal(septemberOdd.dueYearParity, "odd", "Next-to-last 7 maps to odd");
equal(
  septemberOdd.nextDueDate,
  "2027-09-30",
  "Odd-year September deadline",
);

const earlyFiling = computeMcs150BiennialClock({
  dotNumber: "2533650",
  lastFiledDate: "2027-01-15",
  asOf: "2027-07-24",
});
equal(
  earlyFiling.satisfiedCycleDueDate,
  "2027-10-31",
  "filing inside the 12-month advance window satisfies the upcoming cycle",
);
equal(
  earlyFiling.nextDueDate,
  "2029-10-31",
  "early qualifying filing advances two years",
);

const tooEarly = computeMcs150BiennialClock({
  dotNumber: "2533650",
  lastFiledDate: "2024-09-30",
  asOf: "2026-07-24",
});
equal(
  tooEarly.nextDueDate,
  "2025-10-31",
  "filing more than 12 months before the deadline does not satisfy it",
);
equal(tooEarly.isOverdue, true, "unsatisfied prior cycle remains overdue");
equal(
  tooEarly.dueWithin60Days,
  true,
  "an overdue filing also meets the due-within-60 trigger",
);

const exactTenPercent = compareMcs150Profiles({
  census: { ...nationwide, annual_mileage: 100, mileage_year: 2025 },
  attested: { ...nationwide, annual_mileage: 110, mileage_year: 2025 },
  asOf: "2026-07-24",
});
check(
  !exactTenPercent.triggerReasons.some(
    ({ code }) => code === "annual_mileage_mismatch",
  ),
  "exactly 10% mileage difference is within tolerance",
);

const overTenPercent = compareMcs150Profiles({
  census: { ...nationwide, annual_mileage: 100, mileage_year: 2025 },
  attested: { ...nationwide, annual_mileage: 111, mileage_year: 2025 },
  asOf: "2026-07-24",
});
check(
  overTenPercent.triggerReasons.some(
    ({ code }) => code === "annual_mileage_mismatch",
  ),
  "more than 10% mileage difference triggers",
);

const countDeltas = compareMcs150Profiles({
  census: nationwide,
  attested: { ...nationwide, power_units: 41, drivers: 46 },
  asOf: "2026-07-24",
});
check(
  countDeltas.triggerReasons.some(
    ({ code }) => code === "power_units_mismatch",
  ),
  "any power-unit delta triggers",
);
check(
  countDeltas.triggerReasons.some(({ code }) => code === "drivers_mismatch"),
  "any driver delta triggers",
);

const staleMileage = compareMcs150Profiles({
  census: { ...nationwide, mileage_year: 2024 },
  attested: { ...nationwide, mileage_year: 2024 },
  asOf: "2026-07-24",
});
check(
  staleMileage.triggerReasons.some(
    ({ code }) => code === "census_mileage_year_stale",
  ),
  "a census mileage year older than current year minus one triggers",
);

const yearMismatch = compareMcs150Profiles({
  census: nationwide,
  attested: { ...nationwide, mileage_year: 2026 },
  asOf: "2026-07-24",
});
check(
  yearMismatch.triggerReasons.some(
    ({ code }) => code === "mileage_year_mismatch",
  ),
  "a mileage-year mismatch triggers",
);

const optionalSourceAbsent = compareMcs150Profiles({
  census: {
    ...nationwide,
    mailing_address: null,
    officials: [],
  },
  attested: {
    ...nationwide,
    mailing_address: "Different private mailing address",
    officials: [{ name: "Private Officer" }],
  },
  asOf: "2026-07-24",
});
check(
  !optionalSourceAbsent.triggerReasons.some(
    ({ code }) =>
      code === "mailing_address_mismatch" || code === "officials_mismatch",
  ),
  "optional fields are ignored when the census source has no value",
);

const optionalNormalized = compareMcs150Profiles({
  census: {
    ...nationwide,
    cargo_types: ["General Freight", "Hazmat Products"],
    physical_address: "380 Clarence Bromell Ct., Tracy, CA 95377",
    officials: [{ name: "Jane Doe", title: "President" }],
  },
  attested: {
    ...nationwide,
    cargo_types: ["hazmat products", "general freight"],
    physical_address: "380 CLARENCE BROMELL CT TRACY CA 95377",
    officials: [{ title: "president", name: "jane doe" }],
  },
  asOf: "2026-07-24",
});
equal(
  optionalNormalized.triggerReasons.length,
  0,
  "case, order, and punctuation normalization prevents false optional mismatches",
);

const optionalMismatch = compareMcs150Profiles({
  census: { ...nationwide, operation_classification: "Interstate" },
  attested: { ...nationwide, operation_classification: "Intrastate" },
  asOf: "2026-07-24",
});
check(
  optionalMismatch.triggerReasons.some(
    ({ code }) => code === "operation_classification_mismatch",
  ),
  "a populated optional census value is compared",
);

const zeroMatch = evaluateMcs150TruthUp({
  dotNumber: "2533650",
  lastFiledDate: "2026-05-08",
  census: nationwide,
  attested: { ...nationwide },
  burdenPoints: 550,
  asOf: "2026-07-24",
});
equal(zeroMatch.shouldTrigger, false, "Nationwide matching values do not trigger");
equal(zeroMatch.deltas.length, 0, "Nationwide matching values have zero deltas");
check(
  zeroMatch.fingerprint.startsWith("mcs150-v1-"),
  "evaluation provides a deterministic versioned fingerprint",
);
equal(
  zeroMatch.fingerprint,
  evaluateMcs150TruthUp({
    dotNumber: "2533650",
    lastFiledDate: "2026-05-08",
    census: { ...nationwide },
    attested: { ...nationwide },
    burdenPoints: 550,
    asOf: "2026-07-25",
  }).fingerprint,
  "fingerprint stays stable while state and due date are unchanged",
);

const dueTrigger = evaluateMcs150TruthUp({
  dotNumber: "2533650",
  lastFiledDate: "2026-05-08",
  census: nationwide,
  attested: nationwide,
  burdenPoints: 550,
  asOf: "2027-10-01",
});
equal(dueTrigger.shouldTrigger, true, "due-within-60 alone triggers truth-up");
check(
  dueTrigger.triggerReasons.some(
    ({ code }) => code === "biennial_due_within_60_days",
  ),
  "due trigger has an explicit reason",
);
equal(
  shouldRunMcs150ScheduledCheck({
    quarterAlreadyChecked: true,
    dueWithin60Days: false,
    dueWindowAlreadyHandled: false,
  }),
  false,
  "a completed quarter skips while the deadline remains outside 60 days",
);
equal(
  shouldRunMcs150ScheduledCheck({
    quarterAlreadyChecked: true,
    dueWithin60Days: true,
    dueWindowAlreadyHandled: false,
  }),
  true,
  "crossing into the 60-day window overrides the calendar-quarter success gate",
);
equal(
  shouldRunMcs150ScheduledCheck({
    quarterAlreadyChecked: true,
    dueWithin60Days: true,
    dueWindowAlreadyHandled: true,
  }),
  false,
  "a successfully handled due window stays idempotent by due date",
);

const prediction = buildMcs150HonestyPrediction({
  census: nationwide,
  proposed: {
    ...nationwide,
    power_units: 50,
    drivers: 50,
    annual_mileage: 1_500_000,
  },
  burdenPoints: 550,
});
equal(
  prediction.burdenPerPowerUnit.before,
  13.75,
  "prediction computes current burden per power unit",
);
equal(
  prediction.burdenPerPowerUnit.after,
  11,
  "prediction computes proposed burden per power unit",
);
equal(
  prediction.burdenPerPowerUnit.direction,
  "lower",
  "prediction states burden direction",
);
equal(
  prediction.driversPerPowerUnit.direction,
  "lower",
  "prediction states driver-utilization direction",
);
check(
  prediction.summary.includes("does not predict or promise"),
  "prediction explicitly disclaims an official percentile promise",
);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      assertions,
      nationwide: {
        dueMonth: nationwideClock.dueMonth,
        dueYearParity: nationwideClock.dueYearParity,
        nextDueDate: nationwideClock.nextDueDate,
        daysRemaining: nationwideClock.daysRemaining,
        truthUpTriggered: zeroMatch.shouldTrigger,
      },
    },
    null,
    2,
  ),
);
