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
      "Each roadside violation is worth 1-10 points, plus 2 if the truck or driver was put out of service. Newer violations count more: triple for the first 6 months, double from 6 to 12 months, and normal from 12 to 24 months. Every violation drops off completely after 24 months, whether or not new violations occur. Insurance is priced from this record. What you control is getting fewer new violations.",
    deliverables: ["Score-mechanics one-pager"],
  },
  {
    key: "A2",
    title: "The weekly safety block",
    installment: "One-pager and recurring checklist",
    content:
      "Reserve 30 minutes at the same time every week. Review every new inspection report, assign each defect to one person with a deadline, check the preventive-maintenance due list, and record repeated problems with the same driver or vehicle. Every safety program depends on this habit.",
    deliverables: ["Weekly safety-block one-pager", "Recurring checklist"],
  },
  {
    key: "A3",
    title: "Driver accountability system",
    installment: "One-pager and policy template",
    content:
      "Use a written policy every driver signs that defines coaching, written warning, and consequences for a first, second, and third violation. Do not allow false entries in driving logs. A written policy makes these safety programs enforceable.",
    deliverables: ["Accountability one-pager", "Driver policy template"],
  },
  {
    key: "A4",
    title: "A real preventive maintenance program",
    installment: "One-pager and preventive maintenance schedule template",
    content:
      "Put every vehicle on a mileage- or time-based preventive-maintenance schedule and retain documented periodic inspections. Scheduled preventive maintenance catches problems with brakes, tires, lights, hoses, steering, and suspension before an inspector finds them.",
    deliverables: ["Preventive-maintenance one-pager", "preventive maintenance schedule template"],
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
      "Before each trip, look for oil streaks that could mean a leaking wheel seal.",
    ],
    workingWhen: [
      "Zero new tire or wheel violations in a rolling 90-day window.",
      "Complete the fueling checklist more than 90 percent of the time.",
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
      "Light and wiring defects are common, inexpensive to prevent, and visible during careful checks before a trip or in the yard.",
    program: [
      "Run a two-person 90-second lamp check in pre-trip; solo drivers use a reflection or phone-video walk.",
      "Stock every tractor with a spare bulb and fuse kit for yard repairs.",
      "Check and record the lights on every vehicle in the yard on the first Friday of each month.",
      "Convert dangling, loose, or chafed wiring found in pre-trip into a same-day repair ticket.",
    ],
    workingWhen: [
      "Inspection reports stop listing light or wiring defects.",
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
    name: "Accurate Driving Logs",
    priority: 3,
    riskContext:
      "False driving logs are more than paperwork mistakes. Repeated violations and orders to stop driving can lead to a company safety review and affect its safety rating.",
    program: [
      "Have every driver sign a policy that prohibits false driving logs and explains the consequences.",
      "During the weekly safety block, review the electronic driving log unassigned-driving-time and edit reports.",
      "Check that dispatch schedules allow drivers to finish within legal driving hours, without making false log entries.",
      "Document every audit and corrective conversation.",
    ],
    workingWhen: [
      "Zero new violations for false driving logs.",
      "Report any new violation immediately to the company owner or safety manager.",
    ],
    installments: [
      "One-pager: What a false log actually costs",
      "Weekly electronic driving log back-office audit checklist",
      "Driver policy signature form",
    ],
  },
  brakes_air: {
    key: "brakes_air",
    code: "B4",
    name: "Brakes & Air System",
    priority: 4,
    riskContext:
      "Problems with brake hoses, air leaks, anti-lock braking system warnings, or brake travel can lead to an order to stop operating. Preventive maintenance should catch them.",
    program: [
      "At every preventive maintenance service, inspect hose routing, attachments, rubbing, brake travel, and adjustment.",
      "Require same-day reporting and repair for any audible air leak.",
      "Treat every anti-lock braking system warning lamp as a repair ticket rather than a cosmetic light.",
      "Check brake stroke and adjustment at each preventive-maintenance service.",
    ],
    workingWhen: ["Zero hose, leak, or anti-lock braking system violations in 120 days."],
    installments: [
      "Brakes and air one-pager",
      "Preventive maintenance brake and hose checklist insert",
      "Toolbox talk: the leak you can hear is the violation you will get",
    ],
  },
  eld_hygiene: {
    key: "eld_hygiene",
    code: "B5",
    name: "Electronic Driving Log Routines",
    priority: 5,
    riskContext:
      "Unsigned logs, driving time with no driver assigned, missing required details, failed record transfers, and poorly mounted log devices cause repeated paperwork violations and show that daily checks need attention.",
    program: [
      "Teach a 60-second routine at the end of each day: confirm and sign the prior driving log, assign driving time to the right driver or explain it, and check the shipping document number.",
      "Have every driver practice sending electronic driving logs to an inspection officer.",
      "Before each trip, check that the portable electronic driving log device is securely mounted.",
      "Clear unassigned driving time in the back office each week with the same report used for driving log accuracy review.",
    ],
    workingWhen: ["Zero electronic driving log violations across two consecutive quarters."],
    installments: [
      "Driver pocket card: 60 seconds before you sleep",
      "Four-minute video script",
      "Weekly office checklist shared with Accurate Driving Logs",
    ],
  },
  driver_behavior: {
    key: "driver_behavior",
    code: "B6",
    name: "Driver Behavior on the Road",
    priority: 6,
    riskContext:
      "Violations for speeding, traffic signals, phone use, seat belts, lane use, and warning signals add points and raise serious safety concerns.",
    program: [
      "Use a signed speed policy with a hard cap and a target of five miles per hour below the posted limit.",
      "Enable and review vehicle tracking system speed alerts during the weekly safety block when available.",
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
    name: "Reflective Tape & Body",
    priority: 8,
    riskContext:
      "Checking reflective tape, mud flaps, seasonal equipment, and body or tank attachments is a low-cost way to prepare for inspections.",
    program: [
      "Inspect and replace worn reflective tape at preventive-maintenance service.",
      "Add mud-flap and body-securement checks to pre-trip.",
      "Use a dispatch calendar reminder to carry required chains during mountain-route season.",
    ],
    workingWhen: ["Zero new reflective tape or body violations for 12 months."],
    installments: [
      "Preventive maintenance checklist insert",
      "Seasonal dispatch reminder",
    ],
  },
  steering_suspension: {
    key: "steering_suspension",
    code: "B9",
    name: "Steering & Suspension",
    priority: 9,
    riskContext:
      "Steering and suspension problems may be uncommon, but they can cause serious harm and orders to stop operating. Check them during preventive maintenance.",
    program: [
      "At every preventive maintenance service, check steering and suspension fastener tightness, connections, and leaks.",
      "Require same-day driver reporting of wander, pull, or abnormal steering feel.",
    ],
    workingWhen: ["Zero recurrence."],
    installments: ["Preventive maintenance checklist insert"],
  },
  hours_limits: {
    key: "hours_limits",
    code: "B10",
    name: "Hours Limits",
    priority: 10,
    riskContext:
      "Driving beyond allowed hours can signal pressure from dispatch, especially when there is also a history of false driving logs.",
    program: [
      "Cover hours limits in the dispatch-pressure audit and the driver's daily electronic driving log routine.",
      "Create a separate corrective program only if the violation recurs.",
    ],
    workingWhen: ["Zero new hours-limit violations."],
    installments: ["No separate lesson unless this type of violation happens again"],
  },
  cargo_securement: {
    key: "cargo_securement",
    code: "B11",
    name: "Cargo Securement",
    priority: 11,
    riskContext:
      "Loose cargo parts or packing and bracing materials should be caught during loading and checks before a trip. They can lead to an order to stop operating.",
    program: [
      "Add packing and bracing materials and vehicle-component securement to pre-trip and loading checks.",
      "Run a focused toolbox talk if this type of violation happens again.",
    ],
    workingWhen: ["Zero new cargo-securement violations."],
    installments: ["Pre-trip checklist line", "Toolbox talk if this type of violation happens again"],
  },
  driver_qualification: {
    key: "driver_qualification",
    code: "B12",
    name: "Driver Qualifications: Speaking and Reading English",
    priority: 12,
    riskContext:
      "A driver who cannot meet the requirements for speaking and reading English may be ordered to stop driving. Check these skills when hiring and reviewing drivers.",
    program: [
      "Check current drivers against federal truck safety agency guidance on speaking English in basic conversations and understanding road signs.",
      "Add speaking and reading English to the hiring checklist.",
      "Give the driver targeted help or plan appropriate routes until the problem is resolved.",
    ],
    workingWhen: ["No new violations for speaking or reading English, and these skills are checked during hiring."],
    installments: [
      "Hiring-checklist update",
      "Manager one-pager on current checks for speaking and reading English",
    ],
  },
  general_safety: {
    key: "general_safety",
    code: "GS",
    name: "General Safety",
    priority: 99,
    riskContext:
      "These violations have not yet been assigned to a specific safety program. The SafeScore team must review them before choosing the right program.",
    program: [
      "Review each violation that has no assigned safety program during the weekly safety block.",
      "Use the inspection facts to assign each correction to one person with a deadline.",
      "Have the SafeScore team review the facts and assign the right safety program; do not rely on an unchecked computer suggestion.",
    ],
    workingWhen: [
      "Every violation is reviewed and assigned to a specific safety program.",
      "No repeat violations while the safety program review is pending.",
    ],
    installments: ["SafeScore team review of the right safety program", "General corrective-action checklist"],
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
      objective: "Start the weekly safety routine and prevent new tire and wheel violations.",
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
      title: "Accountability and accurate driving logs",
      ownerModuleKeys: ["A3"],
      familyKeys: filteredFamilyKeys(present, ["log_integrity"]),
      objective: "Set clear rules and consequences for keeping accurate driving logs.",
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
      objective: "Use a written inspection schedule to catch safety defects during preventive maintenance.",
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
      title: "Electronic driving log routines",
      familyKeys: filteredFamilyKeys(present, ["eld_hygiene"]),
      objective: "Stop repeated problems with signing electronic driving logs, sending them to officers, and filling in required details.",
      deliverables: presentFamilyDeliverables(present, ["eld_hygiene"]),
    }),
    installment({
      month: 6,
      title: "Driver behavior and quarterly score-impact review",
      familyKeys: filteredFamilyKeys(present, ["driver_behavior"]),
      objective: "Coach drivers on their repeated driving violations and review new violations from the last six months.",
      deliverables: [
        ...presentFamilyDeliverables(present, ["driver_behavior"]),
        "Quarterly score-impact review",
      ],
    }),
    installment({
      month: 7,
      title: "Reflective tape and body",
      familyKeys: filteredFamilyKeys(present, ["conspicuity_body"]),
      objective: "Close visible body, tape, mud-flap, and seasonal-equipment defects.",
      deliverables: presentFamilyDeliverables(present, ["conspicuity_body"]),
    }),
    installment({
      month: 8,
      title: "Driver qualification",
      familyKeys: filteredFamilyKeys(present, ["driver_qualification"]),
      objective: "Check speaking and reading English when hiring and reviewing drivers.",
      deliverables: presentFamilyDeliverables(present, [
        "driver_qualification",
      ]),
    }),
    installment({
      month: 9,
      title: "More practice in the safety area with the most new violations",
      familyKeys: weakestFamilyKeys,
      objective:
        "Focus on the safety area with the highest rate of new violations and check its early signs of progress.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly review of new violations and completion of safety routines",
      ],
    }),
    installment({
      month: 10,
      title: "Recheck the safety area with the most new violations",
      familyKeys: weakestFamilyKeys,
      objective:
        "Recheck the safety area with the highest rate of new violations and correct any missed steps in its program.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly review of new violations and completion of safety routines",
      ],
    }),
    installment({
      month: 11,
      title: "More practice in the safety area with the most new violations",
      familyKeys: weakestFamilyKeys,
      objective:
        "Review the safety area with the highest rate of new violations using the latest inspection results.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Monthly review of new violations and completion of safety routines",
      ],
    }),
    installment({
      month: 12,
      title: "Annual recheck of the safety area with the most new violations",
      familyKeys: weakestFamilyKeys,
      objective:
        "Recheck the safety area with the highest rate of new violations, finish the annual review, and plan the next steps.",
      deliverables: [
        ...weakestFamilyDeliverables,
        "Annual review of new violations and completion of safety routines",
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
            "Review new violations in each safety area and practice the steps in the current lessons.",
          deliverables: ["Monthly review of new violations and completion of safety routines"],
        }
      : entry
  );
}
