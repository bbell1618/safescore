/**
 * MCS-150 accuracy checker
 * Compares registration data to actual fleet operations and flags discrepancies
 */

export interface Mcs150Check {
  field: string;
  registeredValue: string;
  observedValue: string;
  discrepancy: string;
  impact: "high" | "medium" | "low";
}

export function checkMcs150Accuracy(params: {
  registeredPowerUnits: number | null;
  actualPowerUnits: number | null;
  registeredDrivers: number | null;
  actualDrivers: number | null;
  registeredMileage: number | null;
  estimatedAnnualMileage: number | null;
  lastFilingDate: string | null;
}): Mcs150Check[] {
  const discrepancies: Mcs150Check[] = [];
  const {
    registeredPowerUnits,
    actualPowerUnits,
    registeredDrivers,
    actualDrivers,
    registeredMileage,
    estimatedAnnualMileage,
    lastFilingDate,
  } = params;

  // Power units check
  if (registeredPowerUnits !== null && actualPowerUnits !== null) {
    if (registeredPowerUnits > actualPowerUnits * 1.2) {
      discrepancies.push({
        field: "Power Units",
        registeredValue: String(registeredPowerUnits),
        observedValue: String(actualPowerUnits),
        discrepancy: `MCS-150 shows ${registeredPowerUnits} power units but fleet appears to have ${actualPowerUnits}. Overstating power units inflates BASIC denominators and can worsen percentile rankings.`,
        impact: "high",
      });
    } else if (registeredPowerUnits < actualPowerUnits * 0.8) {
      discrepancies.push({
        field: "Power Units",
        registeredValue: String(registeredPowerUnits),
        observedValue: String(actualPowerUnits),
        discrepancy: `MCS-150 shows ${registeredPowerUnits} power units but fleet appears to have ${actualPowerUnits}. Understating can trigger compliance reviews.`,
        impact: "medium",
      });
    }
  }

  // Driver count check
  if (registeredDrivers !== null && actualDrivers !== null) {
    if (Math.abs(registeredDrivers - actualDrivers) > 3) {
      discrepancies.push({
        field: "Driver Count",
        registeredValue: String(registeredDrivers),
        observedValue: String(actualDrivers),
        discrepancy: `MCS-150 shows ${registeredDrivers} drivers but current roster has ${actualDrivers}. Driver count affects BASIC measurement denominators.`,
        impact: "medium",
      });
    }
  }

  // Mileage check (if significantly different)
  if (registeredMileage !== null && estimatedAnnualMileage !== null) {
    const ratio = registeredMileage / estimatedAnnualMileage;
    if (ratio < 0.5 || ratio > 2.0) {
      discrepancies.push({
        field: "Annual Mileage",
        registeredValue: `${registeredMileage.toLocaleString()} miles`,
        observedValue: `~${estimatedAnnualMileage.toLocaleString()} miles (estimated)`,
        discrepancy: `Reported mileage may be significantly inaccurate. Mileage affects the Vehicle Maintenance BASIC calculation.`,
        impact: "medium",
      });
    }
  }

  // Filing recency check
  if (lastFilingDate) {
    const filingDate = new Date(lastFilingDate);
    const monthsAgo = (Date.now() - filingDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo > 24) {
      discrepancies.push({
        field: "Filing Recency",
        registeredValue: lastFilingDate,
        observedValue: `${Math.round(monthsAgo)} months ago`,
        discrepancy: `MCS-150 was filed over 2 years ago. Carriers are required to update every 24 months. An outdated filing may contain inaccurate data that affects BASIC scores.`,
        impact: "high",
      });
    }
  }

  return discrepancies;
}
