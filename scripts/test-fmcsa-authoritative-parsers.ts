import assert from "node:assert/strict";
import {
  getMotusCarrierSnapshot,
  parseMotusCarrierSnapshot,
} from "../lib/fmcsa/motus";
import { parseSAFERSnapshotHtml } from "../lib/fmcsa/safer";

const dotNumber = "2533650";
const saferUrl =
  "https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=2533650";

function motusFixture() {
  return {
    detail: {
      entityId: "entity-1",
      entityName: "NATIONWIDE CARRIER INC",
      outOfService: false,
      entityDotNumber: {
        dotNumber,
        dotNumberStatus: { dotNumberStatus: "Active" },
      },
      entityRegistrations: [
        {
          entityRegistrationId: "registration-1",
          commonAppPend: null,
          contractAppPend: null,
          brokerAppPend: null,
          commonRevPend: null,
          contractRevPend: null,
          brokerRevPend: null,
          processingProtestPeriod: false,
          minCovAmount: "750.00",
          bipdFile: "1000.00",
          entityRegistrationOperatingAuthorities: [
            {
              entityOperatingAuthority: {
                docketNumber: "MC880750",
                createDate: "2020-10-21T04:00:00.000Z",
                updateDate: "2026-06-09T00:51:58.692Z",
                protestPeriodStartDate: null,
                operatingAuthorityType: {
                  operatingAuthorityType:
                    "Motor Carrier of Property (Except Household Goods)",
                },
                operatingAuthorityStatus: {
                  operatingAuthorityStatusName: "Active",
                },
              },
            },
          ],
        },
      ],
    },
    financialPages: [
      {
        total: 1,
        tableData: [
          {
            filingId: "filing-1",
            opAuthType:
              "Motor Carrier of Property (Except Household Goods)",
            insuranceCompanyName: "",
            policyNum: "FBCAT0605500",
            filingStatus: "Active",
            filingStatusReason: "",
            insFormType: "BMC-91X",
            insuranceFormDesc:
              "Motor Carrier Automobile Bodily Injury and Property Damage Liability Certificate of Insurance",
            insFiled: "1000000.00",
            insClass: "Primary",
            recDate: "2024-06-06T04:00:00.000Z",
            polEffDate: "2024-06-25T04:00:00.000Z",
            polCancelDate: "",
            submittedBy: "",
          },
        ],
      },
    ],
    allHistory: [],
    registrationHistories: [[]],
  };
}

async function main() {
  const saferResponse = await fetch(saferUrl);
  assert.equal(saferResponse.ok, true);
  const saferHtml = await saferResponse.text();
  const safer = parseSAFERSnapshotHtml(
    saferHtml,
    dotNumber,
    "2026-07-29T00:00:00.000Z",
  );
  assert.equal(safer.legalName, "NATIONWIDE CARRIER INC");
  assert.deepEqual(safer.operationClassifications, ["Auth. For Hire"]);
  assert.deepEqual(safer.carrierOperations, ["Interstate"]);
  assert.deepEqual(safer.docketNumbers, ["MC-880750"]);
  assert.equal(safer.mcNumber, "880750");
  assert.deepEqual(safer.cargoTypes, [
    "General Freight",
    "Metal: sheets, coils, rolls",
    "Building Materials",
    "Fresh Produce",
    "Meat",
    "Chemicals",
    "Refrigerated Food",
    "Beverages",
    "Paper Products",
    "HAZMAT PRODUCTS",
  ]);
  assert.throws(
    () =>
      parseSAFERSnapshotHtml(
        saferHtml.replace('summary="Carrier Operation"', "summary-removed"),
        dotNumber,
      ),
    /Layout drift.*Carrier Operation/,
  );

  const fixture = motusFixture();
  const parsedFixture = parseMotusCarrierSnapshot({
    dotNumber,
    ...fixture,
  });
  assert.equal(parsedFixture.authorities[0].minimumBipdCoverage, 750_000);
  assert.equal(parsedFixture.authorities[0].filedBipdCoverage, 1_000_000);
  assert.equal(parsedFixture.insuranceFilings[0].insuranceCompanyName, null);
  assert.equal(parsedFixture.insuranceFilings[0].cancellationDate, null);
  assert.deepEqual(parsedFixture.authorityHistory, []);

  assert.throws(
    () =>
      parseMotusCarrierSnapshot({
        dotNumber,
        ...fixture,
        financialPages: [{ total: 0 }],
      }),
    /tableData must be an array/,
  );
  assert.throws(
    () =>
      parseMotusCarrierSnapshot({
        dotNumber,
        ...fixture,
        allHistory: [{ unknown: "unmapped" }],
      }),
    /parser update required/,
  );

  const motus = await getMotusCarrierSnapshot(dotNumber);
  assert.equal(motus.legalName, "NATIONWIDE CARRIER INC");
  assert.deepEqual(motus.docketNumbers, ["MC-880750"]);
  assert.equal(motus.authorities[0].status, "Active");
  assert.equal(motus.insuranceFilings[0].formType, "BMC-91X");
  assert.equal(motus.insuranceFilings[0].filedAmount, 1_000_000);
  assert.equal(motus.insuranceFilings[0].insuranceCompanyName, null);
  assert.deepEqual(motus.authorityHistory, []);

  console.log(
    JSON.stringify(
      {
        safer: {
          sourceAsOf: safer.saferAsOf,
          operationClassifications: safer.operationClassifications,
          carrierOperations: safer.carrierOperations,
          docketNumbers: safer.docketNumbers,
          cargoTypes: safer.cargoTypes,
          layoutDrift: "failed_loudly",
        },
        motus: {
          dotNumber: motus.dotNumber,
          usdotStatus: motus.usdotStatus,
          outOfService: motus.outOfService,
          docketNumbers: motus.docketNumbers,
          authorities: motus.authorities,
          insuranceFilings: motus.insuranceFilings,
          pendingActions: motus.pendingActions,
          authorityHistory: motus.authorityHistory,
          malformedFinancialShape: "failed_loudly",
          unknownHistoryShape: "failed_loudly",
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
