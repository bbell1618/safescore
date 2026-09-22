import { portalCopy } from "@/lib/portal/copy";

/** Display-only wording. Stored records, codes, numbers and action payloads stay intact. */
export function ownerCopy(value: string | null | undefined): string {
  return portalCopy(value)
    .replace(/\bFMCSA\b/g, "the federal truck safety agency")
    .replace(/\bDataQs?\b/g, "safety record correction")
    .replace(/\bCPDP\b/g, "crash preventability review")
    .replace(/\bRDR\b/g, "record correction request")
    .replace(/\bBASICs?\b/g, "safety category")
    .replace(/\bOOS\b/g, "out of service")
    .replace(/\bCDL\b/g, "commercial driver's license")
    .replace(/\bCMV\b/g, "commercial vehicle")
    .replace(/\bELD\b/g, "electronic driving log")
    .replace(/\bHOS\b/g, "driving and work hours")
    .replace(/\bPM\b/g, "preventive maintenance")
    .replace(/\bABS\b/g, "anti-lock braking system")
    .replace(/\belectronic driving log hygiene\b/gi, "electronic driving log routines")
    .replace(/\bsevere loss optics\b/gi, "serious safety concerns")
    .replace(/\boperating cadence\b/gi, "work routine")
    .replace(/\bHazmat\b/gi, "hazardous materials")
    .replace(/\bConspicuity\b/gi, "Reflective tape and visibility")
    .replace(/\bweighted violation burden\b/gi, "violation points")
    .replace(/\bviolation burden\b/gi, "violation points")
    .replace(/\bchallengeability\b/gi, "whether the record can be corrected")
    .replace(/\binflow rate\b/gi, "rate of new violations");
}
