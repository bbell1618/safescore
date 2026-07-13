import type { BasicCategory } from "@/lib/supabase/types";

export const ALL_BASIC_CATEGORIES = [
  "unsafe_driving",
  "hos_compliance",
  "driver_fitness",
  "controlled_substance",
  "vehicle_maintenance",
  "hazmat_compliance",
  "crash_indicator",
] as const satisfies readonly BasicCategory[];

export type AllBasicsCategory = (typeof ALL_BASIC_CATEGORIES)[number];

export type OfficialBasicMeasure = {
  label: string;
  measure: number | null;
  percentile: number | null;
  threshold: number | null;
  alert: boolean;
  detail: string | null;
};

export type AllBasicsExport = {
  snapshotDate: string;
  basics: Record<AllBasicsCategory, OfficialBasicMeasure>;
};
