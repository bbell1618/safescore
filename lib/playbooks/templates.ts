import type {
  LaneCFamilyGroup,
  PlaybookFamilyDefinition,
  PlaybookFamilyKey,
  PlaybookInstallment,
  PlaybookOwnerModule,
} from "@/lib/playbooks/types";

export const PLAYBOOK_TEMPLATE_VERSION = "u7-golden-artifact-2026-07-22";

export const OWNER_CURRICULUM: readonly PlaybookOwnerModule[] = [
  {
    key: "A1",
    title: "How your score actually works",
    installment: "One-pager",
    content:
      "Every roadside violation carries 1-10 severity points, plus 2 if it puts the truck out of service, multiplied by 3 for the first 12 months. Nothing the carrier fixes removes old points; they fade with time and are gone at 24 months only if new ones stop arriving. Insurance is priced from this record. The controllable lever is the inflow rate: fewer new violations lets the record heal.",
    deliverables: ["Score-mechanics one-pager"],
  },
  {
    key: "A2",
    title: "The weekly safety block",
    installment: "One-pager and recurring checklist",
    content:
      "Reserve 30 minutes at the same time every week. Review every new inspection report, assign each defect to one person with a deadline, check the preventive-maintenance due list, and record repeating driver or unit patterns. Every family program depends on this habit.",
    deliverables: ["Weekly safety-block one-pager", "Recurring checklist"],
  },
  {
    key: "A3",
    title: "Driver accountability system",
    installment: "One-pager and policy template",
    content:
      "Use a written policy every driver signs that defines coaching, written warning, and consequences for a first, second, and third violation. Log falsification has zero tolerance. Without written accountability, the family programs are suggestions rather than a management system.",
    deliverables: ["Accountability one-pager", "Driver policy template"],
  },
  {
    key: "A4",
    title: "A real PM program",
    installment: "One-pager and PM schedule template",
    content:
      "Put every unit on a mileage- or time-based preventive-maintenance schedule and retain documented periodic inspections. The PM interval is where brakes, tires, lights, hoses, steering, and suspension are caught before an inspector finds them.",
    deliverables: ["Preventive-maintenance one-pager", "PM schedule template"],
  },
] as const;

export const FAMILY_DEFINITIONS: Readonly<
  Record<PlaybookFamilyKey, PlaybookFamilyDefinition>
> = {
  tires_wheels: {
    key: "tires_wheels",
    code: "B1",
    name: "Tires & Wheels",
    priority: 1,
    riskContext:
      "Tire pressure, tread, casing, wheel, hub, and seal defects are visible roadside failures that drivers and preventive maintenance should find first.",
    program: [
      "Use a calibrated tread-depth gauge and pressure check at every fueling; log the three-minute check.",
      "Set the internal replacement threshold at 4/32 inch instead of riding to the legal 2/32 inch minimum.",
      "Verify automatic tire-inflation systems at every preventive-maintenance service.",
      "Add an oil-streak wheel-seal visual to the pre-trip inspection.",
    ],
    workingWhen: [
      "Zero new tire or wheel violations in a rolling 90-day window.",
      "Fueling-card completion above 90 percent.",
    ],
    installments: [
      "One-pager: Tires fail inspections before they fail you",
      "Fueling pocket checklist",
    ],
  },
  lighting_electrical: {
    key: "lighting_electrical",
    code: "B2",
    name: "Lighting & Electrical",
    priority: 2,
    riskContext:
      "Lamp and wiring defects are common, inexpensive to prevent, and directly observable in a disciplined pre-trip or yard audit.",
    program: [
      "Run a two-person 90-second lamp check in pre-trip; solo drivers use a reflection or phone-video walk.",
      "Stock every tractor with a spare bulb and fuse kit for yard repairs.",
      "Run and log an all-unit yard light audit on the first Friday of each month.",
      "Convert dangling, loose, or chafed wiring found in pre-trip into a same-day repair ticket.",
    ],
    workingWhen: [
      "Clean inspections stop listing lamps or wiring.",
      "Zero new lighting violations in a rolling 90-day window.",
    ],
    installments: [
      "Lighting one-pager",
      "Laminated pre-trip lamp checklist",
      "Three-minute video script: the 90-second light walk",
    ],
  },
  log_integrity: {
    key: "log_integrity",
    code: "B3",
    name: "Log Integrity (False Logs)",
    priority: 3,
    riskContext:
      "False records of duty status are not paperwork mistakes. Repetition and out-of-service findings create company-level audit and safety-rating exposure.",
    program: [
      "Adopt a signed zero-tolerance falsification policy tied to the driver-accountability module.",
      "During the weekly safety block, review the ELD unassigned-driving-time and edit reports.",
      "Audit whether dispatch schedules can be completed legally instead of pushing drivers toward falsification.",
      "Document every audit and corrective conversation.",
    ],
    workingWhen: [
      "Zero new falsification violations.",
      "Any single new violation triggers immediate company-level escalation.",
    ],
    installments: [
      "One-pager: What a false log actually costs",
      "Weekly ELD back-office audit checklist",
      "Driver policy signature form",
    ],
  },
  brakes_air: {
    key: "brakes_air",
    code: "B4",
    name: "Brakes & Air System",
    priority: 4,
    riskContext:
      "Brake hoses, air leaks, ABS warnings, and brake-stroke defects are preventive-maintenance catches with serious out-of-service exposure.",
    program: [
      "At every PM, inspect hose routing, securement, chafe points, brake stroke, and adjustment.",
      "Require same-day reporting and repair for any audible air leak.",
      "Treat every ABS warning lamp as a repair ticket rather than a cosmetic light.",
      "Check brake stroke and adjustment at each preventive-maintenance service.",
    ],
    workingWhen: ["Zero hose, leak, or ABS citations in 120 days."],
    installments: [
      "Brakes and air one-pager",
      "PM brake and hose checklist insert",
      "Toolbox talk: the leak you can hear is the violation you will get",
    ],
  },
  eld_hygiene: {
    key: "eld_hygiene",
    code: "B5",
    name: "ELD Hygiene",
    priority: 5,
    riskContext:
      "Certification, unassigned driving, transfer, form-and-manner, document-number, and mounting failures create persistent low-severity noise and signal weak controls.",
    program: [
      "Teach an end-of-day 60-second routine: certify the prior log, claim or annotate unassigned time, and verify the shipping-document number.",
      "Have every driver practice the ELD transfer-to-officer function.",
      "Add the portable-ELD mount to pre-trip.",
      "Clear unassigned driving time in the back office each week with the same report used for log-integrity review.",
    ],
    workingWhen: ["Zero ELD-family citations across two consecutive quarters."],
    installments: [
      "Driver pocket card: 60 seconds before you sleep",
      "Four-minute video script",
      "Back-office weekly checklist shared with Log Integrity",
    ],
  },
  driver_behavior: {
    key: "driver_behavior",
    code: "B6",
    name: "Driver Behavior on the Road",
    priority: 6,
    riskContext:
      "Speed, traffic-control, phone, seat-belt, lane, and warning-signal behavior produces expensive points and severe loss optics.",
    program: [
      "Use a signed speed policy with a hard cap and a target of five miles per hour below the posted limit.",
      "Enable and review telematics speed alerts during the weekly safety block when available.",
      "Require hands-free phone use and apply the same progressive consequences as the accountability policy.",
      "Coach the named drivers on the inspection record and track repeat behavior by driver.",
    ],
    workingWhen: [
      "Zero new moving violations for six months.",
      "Named repeat drivers improve or move through the written accountability process.",
    ],
    installments: [
      "One-pager: the 10-point violations",
      "Driver policy addendum",
      "Toolbox-talk script",
    ],
  },
  emergency_cab: {
    key: "emergency_cab",
    code: "B7",
    name: "Emergency & Cab Equipment",
    priority: 7,
    riskContext:
      "Warning devices and fire-extinguisher deficiencies are inexpensive yard-audit fixes that should not recur.",
    program: [
      "Audit every cab for warning triangles and a rated, mounted, charged fire extinguisher.",
      "Add both equipment checks to the pre-trip checklist.",
    ],
    workingWhen: ["No new emergency-equipment citation."],
    installments: [
      "Emergency-equipment checklist lines folded into the Lighting pre-trip card",
    ],
  },
  conspicuity_body: {
    key: "conspicuity_body",
    code: "B8",
    name: "Conspicuity & Body",
    priority: 8,
    riskContext:
      "Reflective sheeting, mud flaps, seasonal equipment, and body or tank securement are low-cost inspection-readiness controls.",
    program: [
      "Inspect and replace worn conspicuity tape at preventive-maintenance service.",
      "Add mud-flap and body-securement checks to pre-trip.",
      "Use a dispatch calendar reminder to carry required chains during mountain-route season.",
    ],
    workingWhen: ["Zero new conspicuity or body violations for 12 months."],
    installments: [
      "PM checklist insert",
      "Seasonal dispatch reminder",
    ],
  },
  steering_suspension: {
    key: "steering_suspension",
    code: "B9",
    name: "Steering & Suspension",
    priority: 9,
    riskContext:
      "Steering and suspension defects may be infrequent, but their outcome and out-of-service severity demand a preventive-maintenance control.",
    program: [
      "Add steering and suspension torque, coupling, and leak checks to every PM.",
      "Require same-day driver reporting of wander, pull, or abnormal steering feel.",
    ],
    workingWhen: ["Zero recurrence."],
    installments: ["PM checklist insert"],
  },
  hours_limits: {
    key: "hours_limits",
    code: "B10",
    name: "Hours Limits",
    priority: 10,
    riskContext:
      "A true over-hours finding can indicate dispatch pressure, especially when it appears beside false-log history.",
    program: [
      "Cover hours limits in the dispatch-pressure audit and the driver's daily ELD routine.",
      "Create a separate corrective program only if the violation recurs.",
    ],
    workingWhen: ["Zero new hours-limit violations."],
    installments: ["No standalone installment unless the family recurs"],
  },
  cargo_securement: {
    key: "cargo_securement",
    code: "B11",
    name: "Cargo Securement",
    priority: 11,
    riskContext:
      "Unsecured cargo components or dunnage are direct pre-trip and loading-control failures with out-of-service potential.",
    program: [
      "Add dunnage and vehicle-component securement to pre-trip and loading checks.",
      "Run a focused toolbox talk if the family recurs.",
    ],
    workingWhen: ["Zero new cargo-securement violations."],
    installments: ["Pre-trip checklist line", "Toolbox talk if the family recurs"],
  },
  driver_qualification: {
    key: "driver_qualification",
    code: "B12",
    name: "Driver Qualification (English Language Proficiency)",
    priority: 12,
    riskContext:
      "English-language-proficiency findings create a driver-level out-of-service risk and belong in hiring and qualification controls.",
    program: [
      "Assess current drivers against FMCSA English-language-proficiency guidance for basic conversation and road-sign comprehension.",
      "Add English-language proficiency to the hiring checklist.",
      "Give the cited driver targeted support or route planning until the exposure is resolved.",
    ],
    workingWhen: ["No new English-language-proficiency citations and the hiring check is active."],
    installments: [
      "Hiring-checklist update",
      "Manager one-pager on current English-language-proficiency enforcement",
    ],
  },
  general_safety: {
    key: "general_safety",
    code: "GS",
    name: "General Safety",
    priority: 99,
    riskContext:
      "This family contains only unmapped violation codes. The mapping must be extended before a specific curated program can replace this general control.",
    program: [
      "Review each unmapped code during the weekly safety block.",
      "Assign a specific corrective owner and deadline from the inspection facts.",
      "Extend the curated family mapping after operator review; do not guess from AI output.",
    ],
    workingWhen: [
      "Every unmapped code is reviewed and added to a curated family.",
      "Zero new recurrence while the mapping is pending.",
    ],
    installments: ["Operator mapping review", "General corrective-action checklist"],
  },
} as const;

function existingFamilyKeys(
  groups: LaneCFamilyGroup[]
): Set<PlaybookFamilyKey> {
  return new Set(groups.map((group) => group.familyKey));
}

function filteredFamilyKeys(
  present: Set<PlaybookFamilyKey>,
  keys: PlaybookFamilyKey[]
): PlaybookFamilyKey[] {
  return keys.filter((key) => present.has(key));
}

function presentFamilyDeliverables(
  present: Set<PlaybookFamilyKey>,
  keys: PlaybookFamilyKey[]
): string[] {
  return keys.flatMap((key) =>
    present.has(key) ? [...FAMILY_DEFINITIONS[key].installments] : []
  );
}

function installment(params: {
  month: number;
  title: string;
  ownerModuleKeys?: PlaybookInstallment["ownerModuleKeys"];
  familyKeys: PlaybookFamilyKey[];
  objective: string;
  deliverables: string[];
}): PlaybookInstallment {
  return {
    month: params.month,
    title: params.title,
    ownerModuleKeys: params.ownerModuleKeys ?? [],
    familyKeys: params.familyKeys,
    objective: params.objective,
    deliverables: params.deliverables,
  };
}

export function buildInstallmentCalendar(
  groups: LaneCFamilyGroup[]
): PlaybookInstallment[] {
  const present = existingFamilyKeys(groups);
  const weakest =
    [...groups].sort(
      (left, right) =>
        right.inflowRatePerMonth - left.inflowRatePerMonth ||
        right.priorityScore - left.priorityScore ||
        left.familyPriority - right.familyPriority
    )[0]?.familyKey ?? null;
  const weakestFamilyKeys: PlaybookFamilyKey[] = weakest ? [weakest] : [];
  const weakestFamilyDeliverables = weakest
    ? [...FAMILY_DEFINITIONS[weakest].installments]
    : [];

  return [
    installment({
      month: 1,
      title: "Score mechanics, weekly safety block, and Tires",
      ownerModuleKeys: ["A1", "A2"],
      familyKeys: filteredFamilyKeys(present, ["tires_wheels"]),
      objective: "Install the weekly operating cadence and stop the most recent tire and wheel inflow.",
      deliverables: [
        ...OWNER_CURRICULUM[0].deliverables,
        ...OWNER_CURRICULUM[1].deliverables,
        ...presentFamilyDeliverables(present, ["tires_wheels"]),
      ],
    }),
    installment({
      month: 2,
      title: "Lighting and emergency equipment",
      familyKeys: filteredFamilyKeys(present, [
        "lighting_electrical",
        "emergency_cab",
      ]),
      objective: "Build the 90-second light walk and close low-cost cab-equipment defects.",
      deliverables: presentFamilyDeliverables(present, [
        "lighting_electrical",
        "emergency_cab",
      ]),
    }),
    installment({
      month: 3,
      title: "Accountability and log integrity",
      ownerModuleKeys: ["A3"],
      familyKeys: filteredFamilyKeys(present, ["log_integrity"]),
      objective: "Make log integrity an enforceable management system.",
      deliverables: [
        ...OWNER_CURRICULUM[2].deliverables,
        ...presentFamilyDeliverables(present, ["log_integrity"]),
      ],
    }),
    installment({
      month: 4,
      title: "Preventive maintenance, brakes, steering, and suspension",
      ownerModuleKeys: ["A4"],
      familyKeys: filteredFamilyKeys(present, [
        "brakes_air",
        "steering_suspension",
      ]),
      objective: "Put PM-catchable safety defects on a documented inspection schedule.",
      deliverables: [
        ...OWNER_CURRICULUM[3].deliverables,
        ...presentFamilyDeliverables(present, [
          "brakes_air",
          "steering_suspension",
        ]),
      ],
    }),
    installment({
      month: 5,
      title: "ELD hygiene",
      familyKeys: filteredFamilyKeys(present, ["eld_hygiene"]),
      objective: "End recurring ELD certification, transfer, and form-and-manner noise.",
      deliverables: presentFamilyDeliverables(present, ["eld_hygiene"]),
    }),
    installment({
      month: 6,
      title: "Driver behavior and quarterly score-impact review",
      familyKeys: filteredFamilyKeys(present, ["driver_behavior"]),
      objective: "Coach the named moving-violation patterns and review six months of inflow.",
      deliverables: [
        ...presentFamilyDeliverables(present, ["driver_behavior"]),
        "Quarterly score-impact review",
      ],
    }),
    installment({
      month: 7,
      title: "Conspicuity and body",
      familyKeys: filteredFamilyKeys(present, ["conspicuity_body"]),
      objective: "Close visible body, tape, mud-flap, and seasonal-equipment defects.",
      deliverables: presentFamilyDeliverables(present, ["conspicuity_body"]),
    }),
    installment({
      month: 8,
      title: "Driver qualification",
      familyKeys: filteredFamilyKeys(present, ["driver_qualification"]),
      objective: "Put English-language proficiency into qualification and hiring controls.",
      deliverables: presentFamilyDeliverables(present, [
        "driver_qualification",
      ]),
    }),
    installment({
      month: 9,
      title: "Weakest-family reinforcement",
      familyKeys: weakestFamilyKeys,
      objective:
        "Reinforce the family with the highest live inflow rate and review its leading indicator.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly inflow and adherence review",
      ],
    }),
    installment({
      month: 10,
      title: "Weakest-family re-audit",
      familyKeys: weakestFamilyKeys,
      objective:
        "Re-audit the weakest live family and correct any lapse in the installed program.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly inflow and adherence review",
      ],
    }),
    installment({
      month: 11,
      title: "Weakest-family reinforcement",
      familyKeys: weakestFamilyKeys,
      objective:
        "Repeat the weakest-family review against the newest inspection inflow.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly inflow and adherence review",
      ],
    }),
    installment({
      month: 12,
      title: "Weakest-family annual re-audit",
      familyKeys: weakestFamilyKeys,
      objective:
        "Re-audit the weakest live family, close the annual cycle, and set the next sequence.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Annual inflow and adherence review",
      ],
    }),
  ].map((entry) =>
    entry.familyKeys.length === 0 &&
    entry.ownerModuleKeys.length === 0 &&
    entry.deliverables.length === 0
      ? {
          ...entry,
          title: "Monthly safety-program review",
          objective:
            "Review current family inflow and reinforce the active installments.",
          deliverables: ["Monthly inflow and adherence review"],
        }
      : entry
  );
}
