import type { BasicCategory } from "@/lib/supabase/types";

export interface InspectionDetailLookup {
  basicCategory: BasicCategory | null;
  severityWeight: number | null;
}

export interface InspectionDetailVehicle {
  unitNumber: number | null;
  unitType: string | null;
  make: string | null;
  vin: string | null;
  licensePlate: string | null;
  licenseState: string | null;
  iepDot: string | null;
}

export interface InspectionDetailViolation {
  violationCode: string;
  violationDescription: string;
  oosViolation: boolean;
  citationNumber: string | null;
  citationResult: string | null;
  convicted: null;
  basicCategory: BasicCategory | null;
  severityWeight: number | null;
  timeWeight: number;
}

export interface InspectionDetailInspection {
  mcmisInspectionId: string;
  reportNumber: string;
  state: string | null;
  inspectionDate: string;
  startTime: string | null;
  endTime: string | null;
  level: string | null;
  locationText: string | null;
  facilityName: string | null;
  postAccidentIndicator: string | null;
  timeWeight: number;
  totalViolations: number;
  oosViolations: number;
  vehicles: InspectionDetailVehicle[];
  violations: InspectionDetailViolation[];
  rawData: Record<string, unknown>;
}
