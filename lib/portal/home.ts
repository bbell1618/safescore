import { BASIC_LABELS } from "@/lib/analysis/basic-measure";

export type PortalHomeBasic = {
  basic_category: string;
  violation_count: number;
  weighted_points: number;
};

export type PortalHomeSnapshot = {
  id: string;
  snapshot_date: string;
  captured_at: string;
  source: string;
  total_points: number;
  per_basic: PortalHomeBasic[];
  violation_count: number;
  inspection_count: number;
  crash_count: number;
  oos_count: number;
};

export type PortalHomeCase = {
  id: string;
  caseType: "DataQ" | "CPDP";
  caseNumber: string | null;
  status: string;
  filedDate: string | null;
  updatedAt: string;
};

export type PortalHomeRequest = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
};

export type PortalHomeWorkNote = {
  id: string;
  text: string;
  createdAt: string;
};

export type PortalHomeAuthority = {
  label: string;
  active: boolean;
  sourceLabel: string;
  fetchedAt: string;
};

export type PortalHomeData = {
  snapshots: PortalHomeSnapshot[];
  cases: PortalHomeCase[];
  requests: PortalHomeRequest[];
  workNotes: PortalHomeWorkNote[];
  investigateQueue: {
    violationCount: number;
    weightedPoints: number;
  };
  authority: PortalHomeAuthority | null;
};

export type PressureLevel = "MAJOR" | "MODERATE" | "MINOR";

export function preferredAuthorityStatus(authorities: unknown[]): string | null {
  const statuses = authorities
    .map((authority) => {
      if (
        authority == null ||
        typeof authority !== "object" ||
        Array.isArray(authority)
      ) {
        return null;
      }
      const status = (authority as Record<string, unknown>).status;
      return typeof status === "string" && status.trim()
        ? status.trim()
        : null;
    })
    .filter((status): status is string => status !== null)
    .sort((left, right) => left.localeCompare(right));
  return (
    statuses.find((status) => status.toLowerCase() === "active") ??
    statuses.find((status) => status.toLowerCase() === "pending") ??
    statuses[0] ??
    null
  );
}

export function pressureLevel(points: number, totalPoints: number): PressureLevel {
  if (totalPoints <= 0 || points <= 0) return "MINOR";
  const share = points / totalPoints;
  if (share >= 0.45) return "MAJOR";
  if (share >= 0.18) return "MODERATE";
  return "MINOR";
}

export function pressureWidth(points: number, totalPoints: number): number {
  if (totalPoints <= 0 || points <= 0) return 0;
  return Math.min(100, Math.max(6, Math.round((points / totalPoints) * 100)));
}

export function inWindowViolationCount(snapshot: PortalHomeSnapshot): number {
  return snapshot.per_basic.reduce(
    (total, basic) => total + basic.violation_count,
    0
  );
}

export function snapshotDeltaLabel(
  latest: PortalHomeSnapshot,
  previous: PortalHomeSnapshot | null
): string {
  if (!previous) return "First snapshot";
  const delta = latest.total_points - previous.total_points;
  if (delta === 0) return "No change since last snapshot";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} since last snapshot`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function readableDate(value: string): string {
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function basicMap(snapshot: PortalHomeSnapshot) {
  return new Map(
    snapshot.per_basic.map((basic) => [basic.basic_category, basic])
  );
}

export function buildChangeNarrative(
  latest: PortalHomeSnapshot | null,
  previous: PortalHomeSnapshot | null
): string[] {
  if (!latest) {
    return [
      "Your first monitoring snapshot is being prepared. Once it is available, this section will explain what moved and why.",
    ];
  }
  if (!previous) {
    return [
      `Monitoring is active as of ${readableDate(latest.snapshot_date)}. Your next snapshot will begin the change history.`,
    ];
  }

  const sentences: string[] = [];
  const totalDelta = latest.total_points - previous.total_points;
  if (totalDelta < 0) {
    sentences.push(
      `Your weighted burden moved ${plural(
        Math.abs(totalDelta),
        "point"
      )} lower since ${readableDate(previous.snapshot_date)}.`
    );
  } else if (totalDelta > 0) {
    sentences.push(
      `Your weighted burden rose by ${plural(
        totalDelta,
        "point"
      )} since ${readableDate(previous.snapshot_date)}.`
    );
  } else {
    sentences.push(
      `Your weighted burden held steady since ${readableDate(
        previous.snapshot_date
      )}.`
    );
  }

  const currentByBasic = basicMap(latest);
  const previousByBasic = basicMap(previous);
  const categories = new Set([
    ...currentByBasic.keys(),
    ...previousByBasic.keys(),
  ]);
  const changedBasics = [...categories]
    .map((basicCategory) => {
      const current = currentByBasic.get(basicCategory);
      const prior = previousByBasic.get(basicCategory);
      return {
        basicCategory,
        pointsDelta:
          (current?.weighted_points ?? 0) - (prior?.weighted_points ?? 0),
        countDelta:
          (current?.violation_count ?? 0) - (prior?.violation_count ?? 0),
      };
    })
    .filter((basic) => basic.pointsDelta !== 0 || basic.countDelta !== 0)
    .sort(
      (left, right) =>
        Math.abs(right.pointsDelta) - Math.abs(left.pointsDelta) ||
        left.basicCategory.localeCompare(right.basicCategory)
    );

  if (changedBasics.length > 0) {
    const lead = changedBasics[0]!;
    const label =
      BASIC_LABELS[lead.basicCategory] ??
      lead.basicCategory.replaceAll("_", " ");
    const movements: string[] = [];
    if (lead.countDelta !== 0) {
      movements.push(
        `${plural(Math.abs(lead.countDelta), "in-window violation")} ${
          lead.countDelta < 0 ? "fewer" : "more"
        }`
      );
    }
    if (lead.pointsDelta !== 0) {
      movements.push(
        `${plural(Math.abs(lead.pointsDelta), "weighted point")} ${
          lead.pointsDelta < 0 ? "lower" : "higher"
        }`
      );
    }
    sentences.push(`${label} led the movement, with ${movements.join(" and ")}.`);
  } else {
    sentences.push("No individual BASIC changed in this snapshot.");
  }

  const violationDelta = latest.violation_count - previous.violation_count;
  if (violationDelta === 0) {
    sentences.push(
      `Your on-file total remains ${plural(
        latest.violation_count,
        "violation"
      )}.`
    );
  } else {
    sentences.push(
      `Your on-file total is now ${plural(
        latest.violation_count,
        "violation"
      )}, ${Math.abs(violationDelta)} ${
        violationDelta < 0 ? "fewer" : "more"
      } than the prior snapshot.`
    );
  }

  const countChanges = [
    {
      label: "inspection",
      delta: latest.inspection_count - previous.inspection_count,
    },
    {
      label: "crash",
      delta: latest.crash_count - previous.crash_count,
    },
    {
      label: "out-of-service event",
      delta: latest.oos_count - previous.oos_count,
    },
  ].filter((change) => change.delta !== 0);

  if (countChanges.length === 0) {
    sentences.push(
      "No inspection, crash, or out-of-service counts changed in this snapshot."
    );
  } else {
    sentences.push(
      countChanges
        .map(
          (change) =>
            `${plural(Math.abs(change.delta), change.label)} ${
              change.delta < 0 ? "left" : "entered"
            } the tracked record`
        )
        .join("; ") + "."
    );
  }

  return sentences;
}

export function portalCaseStatus(status: string): string {
  if (["filed", "pending", "pending_state", "pending_fmcsa"].includes(status)) {
    return "Filed / Pending FMCSA";
  }
  if (status === "draft") return "GEIA is preparing";
  if (status === "reconsidering") return "Under reconsideration";
  if (["approved", "determination_made"].includes(status)) {
    return "Decision received";
  }
  return "In progress";
}

export function buildSparklinePoints(
  values: number[],
  width = 240,
  height = 72,
  padding = 8
): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    return `${width / 2},${height / 2}`;
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  return values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1)) * usableWidth;
      const y = padding + ((maximum - value) / range) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
