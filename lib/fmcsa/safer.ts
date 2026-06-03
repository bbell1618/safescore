/**
 * SAFER Company Snapshot scraper
 * URL: https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=<DOT>
 *
 * No API key required — public FMCSA page.
 * Uses string-slice / regex parsing (no DOM parser available in serverless).
 *
 * HTML structure notes (observed 2026-06-03):
 *   - All label/value pairs use <TH class="querylabelbkg"> / <TD class="queryfield"> patterns
 *   - Inspection table: summary="Inspections", rows: Inspections / Out of Service / Out of Service %
 *     Columns in order: Vehicle, Driver, Hazmat, IEP
 *   - Crash table: summary="Crashes" (US section only — before CaInspections anchor)
 *     Row: Crashes, columns: Fatal, Injury, Tow, Total
 *   - Safety rating: table summary="Review Information" with Rating Date/Review Date/Rating/Type cells
 *   - Cargo table: summary="Cargo Carried" — checked items have <TD class="queryfield">X</TD>
 *     immediately followed by <TD class="queryfield">CARGO TYPE NAME</TD>
 */

const SAFER_BASE =
  "https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=";

export interface SAFERSnapshot {
  legalName: string | null;
  dbaName: string | null;
  entityType: string | null;
  operatingStatus: string | null;
  operatingAuthority: string | null;
  mcs150Date: string | null;       // YYYY-MM-DD normalized
  mcs150MileageYear: number | null;
  mcs150Mileage: number | null;
  powerUnits: number | null;
  drivers: number | null;
  safetyRating: string | null;
  safetyRatingDate: string | null;  // YYYY-MM-DD normalized
  reviewType: string | null;
  reviewDate: string | null;        // YYYY-MM-DD normalized
  cargoTypes: string[];
  hmFlag: boolean;

  // Inspections (24-month trailing, US only)
  vehicleInspections: number | null;
  vehicleOosCount: number | null;
  vehicleOosRate: number | null;    // as percentage e.g. 21.2
  driverInspections: number | null;
  driverOosCount: number | null;
  driverOosRate: number | null;
  hazmatInspections: number | null;
  hazmatOosCount: number | null;
  hazmatOosRate: number | null;

  // Crash totals (24-month trailing, US only)
  crashFatal: number | null;
  crashInjury: number | null;
  crashTow: number | null;
  crashTotal: number | null;

  parsedAt: string;  // ISO timestamp
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert "MM/DD/YYYY" → "YYYY-MM-DD". Returns null if unrecognized. */
function normDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d.trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Strip HTML tags, decode &nbsp; and common entities, trim whitespace. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract text from the first <TD class="queryfield"...> cell that follows the
 * given label anchor string in the HTML.
 */
function extractAfterLabel(html: string, label: string): string | null {
  const idx = html.indexOf(label);
  if (idx === -1) return null;
  // Find the next <TD ... class="queryfield"
  const tdIdx = html.indexOf('class="queryfield"', idx);
  if (tdIdx === -1) return null;
  const closeAngle = html.indexOf(">", tdIdx);
  if (closeAngle === -1) return null;
  const tdEnd = html.indexOf("</TD>", closeAngle);
  if (tdEnd === -1) return null;
  return stripTags(html.slice(closeAngle + 1, tdEnd));
}

/** Parse integer from a string that may contain commas. Returns null if NaN. */
function parseIntSafe(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseInt(s.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? null : n;
}

/** Parse float from a string that may contain commas and %. Returns null if NaN. */
function parseFloatSafe(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s.replace(/,/g, "").replace(/%/g, "").trim());
  return isNaN(n) ? null : n;
}

/**
 * Extract a row of <TD class="queryfield"> cells from a table section.
 * @param tableHtml - the HTML of the table (already sliced to just that table)
 * @param rowLabel  - the text content of the row's <TH> header cell
 * @returns Array of cell text values (stripped), or empty array if not found
 */
function extractTableRow(tableHtml: string, rowLabel: string): string[] {
  // Find the TH that contains rowLabel
  const thPattern = rowLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thMatch = new RegExp(`<TH[^>]*>[\\s\\S]*?${thPattern}[\\s\\S]*?</TH>`, "i").exec(tableHtml);
  if (!thMatch) return [];

  const afterTh = tableHtml.slice(thMatch.index + thMatch[0].length);

  // Collect all <TD class="queryfield"> cells until the next <TR> or </TR> or <TH
  const cells: string[] = [];
  const tdRegex = /<TD[^>]*class="queryfield"[^>]*>([\s\S]*?)<\/TD>/gi;
  let m: RegExpExecArray | null;

  // Limit to content before the next row boundary
  const nextRowIdx = afterTh.search(/<\/TR>/i);
  const rowContent = nextRowIdx > -1 ? afterTh.slice(0, nextRowIdx) : afterTh.slice(0, 2000);

  while ((m = tdRegex.exec(rowContent)) !== null) {
    cells.push(stripTags(m[1]));
  }

  return cells;
}

/**
 * Slice a table from the HTML by its summary attribute.
 * Returns the content between <TABLE ... summary="X"> and its matching </TABLE>.
 */
function extractTableBySummary(html: string, summary: string, startFrom = 0): string | null {
  const searchStr = `summary="${summary}"`;
  const tableStart = html.indexOf(searchStr, startFrom);
  if (tableStart === -1) return null;

  // Walk forward from the <TABLE tag before summary
  const tagStart = html.lastIndexOf("<TABLE", tableStart);
  if (tagStart === -1) return null;

  // Find matching </TABLE> — account for nested tables
  let depth = 1;
  let pos = html.indexOf(">", tableStart) + 1;
  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf("<TABLE", pos);
    const nextClose = html.indexOf("</TABLE>", pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 1;
    } else {
      depth--;
      pos = nextClose + 8; // len("</TABLE>")
    }
  }
  return html.slice(tagStart, pos);
}

/**
 * Parse the US Inspections table (summary="Inspections") that comes BEFORE
 * the Canadian inspections anchor (<A name="CAInspections">).
 *
 * The table has columns: Vehicle, Driver, Hazmat, IEP
 * Rows: Inspections | Out of Service | Out of Service %
 */
function parseUSInspectionTable(html: string): {
  vehicleInspections: number | null;
  vehicleOosCount: number | null;
  vehicleOosRate: number | null;
  driverInspections: number | null;
  driverOosCount: number | null;
  driverOosRate: number | null;
  hazmatInspections: number | null;
  hazmatOosCount: number | null;
  hazmatOosRate: number | null;
} {
  // Slice the HTML to before the Canadian inspections section to avoid
  // accidentally parsing the Canadian table which has the same structure.
  const caAnchor = html.indexOf('name="CAInspections"');
  const usSection = caAnchor > -1 ? html.slice(0, caAnchor) : html;

  // Find the US inspection table (summary="Inspections")
  const tableHtml = extractTableBySummary(usSection, "Inspections");
  if (!tableHtml) {
    console.warn("[safer] US inspection table not found");
    return {
      vehicleInspections: null, vehicleOosCount: null, vehicleOosRate: null,
      driverInspections: null, driverOosCount: null, driverOosRate: null,
      hazmatInspections: null, hazmatOosCount: null, hazmatOosRate: null,
    };
  }

  const inspRow = extractTableRow(tableHtml, "Inspections");
  const oosRow = extractTableRow(tableHtml, "Out of Service");
  const rateRow = extractTableRow(tableHtml, "Out of Service %");

  console.log("[safer] Inspection row cells:", inspRow);
  console.log("[safer] OOS count row cells:", oosRow);
  console.log("[safer] OOS rate row cells:", rateRow);

  // Columns: [0]=Vehicle, [1]=Driver, [2]=Hazmat, [3]=IEP
  return {
    vehicleInspections: parseIntSafe(inspRow[0]),
    driverInspections: parseIntSafe(inspRow[1]),
    hazmatInspections: parseIntSafe(inspRow[2]),
    vehicleOosCount: parseIntSafe(oosRow[0]),
    driverOosCount: parseIntSafe(oosRow[1]),
    hazmatOosCount: parseIntSafe(oosRow[2]),
    vehicleOosRate: parseFloatSafe(rateRow[0]),
    driverOosRate: parseFloatSafe(rateRow[1]),
    hazmatOosRate: parseFloatSafe(rateRow[2]),
  };
}

/**
 * Parse the US crash table (summary="Crashes") that appears in the US section
 * (before the Canadian inspections anchor).
 * Row: Crashes, columns: Fatal, Injury, Tow, Total
 */
function parseUSCrashTable(html: string): {
  crashFatal: number | null;
  crashInjury: number | null;
  crashTow: number | null;
  crashTotal: number | null;
} {
  const caAnchor = html.indexOf('name="CAInspections"');
  const usSection = caAnchor > -1 ? html.slice(0, caAnchor) : html;

  const tableHtml = extractTableBySummary(usSection, "Crashes");
  if (!tableHtml) {
    console.warn("[safer] US crash table not found");
    return { crashFatal: null, crashInjury: null, crashTow: null, crashTotal: null };
  }

  const crashRow = extractTableRow(tableHtml, "Crashes");
  console.log("[safer] Crash row cells:", crashRow);

  // Columns: [0]=Fatal, [1]=Injury, [2]=Tow, [3]=Total
  return {
    crashFatal: parseIntSafe(crashRow[0]),
    crashInjury: parseIntSafe(crashRow[1]),
    crashTow: parseIntSafe(crashRow[2]),
    crashTotal: parseIntSafe(crashRow[3]),
  };
}

/** Parse cargo types from the Cargo Carried table. */
function parseCargoTypes(html: string): string[] {
  const tableHtml = extractTableBySummary(html, "Cargo Carried");
  if (!tableHtml) {
    console.warn("[safer] Cargo Carried table not found");
    return [];
  }

  const cargo: string[] = [];
  // Pattern: <TD class="queryfield">X</TD> immediately followed by the cargo name cell
  const xCellRegex = /<TD[^>]*class="queryfield"[^>]*>\s*X\s*<\/TD>\s*<TD[^>]*class="queryfield"[^>]*>([\s\S]*?)<\/TD>/gi;
  let m: RegExpExecArray | null;
  while ((m = xCellRegex.exec(tableHtml)) !== null) {
    const name = stripTags(m[1]).trim();
    if (name) cargo.push(name);
  }

  console.log("[safer] Cargo types found:", cargo);
  return cargo;
}

/** Parse the safety rating review table. */
function parseSafetyRating(html: string): {
  safetyRating: string | null;
  safetyRatingDate: string | null;
  reviewType: string | null;
  reviewDate: string | null;
} {
  const tableHtml = extractTableBySummary(html, "Review Information");
  if (!tableHtml) {
    console.warn("[safer] Review Information table not found");
    return { safetyRating: null, safetyRatingDate: null, reviewType: null, reviewDate: null };
  }

  // Rating Date: first queryfield cell after "Rating Date:"
  const ratingDate = extractAfterLabel(tableHtml, "Rating Date:");
  const reviewDate = extractAfterLabel(tableHtml, "Review Date:");
  const rating = extractAfterLabel(tableHtml, 'class="querylabelbkg">Rating:');
  const reviewType = extractAfterLabel(tableHtml, 'class="querylabelbkg">Type:');

  // Normalize "None" to null for rating date (no official rating assigned)
  const normRatingDate = normDate(ratingDate === "None" ? null : ratingDate);
  const normReviewDate = normDate(reviewDate === "None" ? null : reviewDate);
  const normRating = (rating === "None" || !rating) ? null : rating;
  const normType = (reviewType === "None" || !reviewType) ? null : reviewType;

  console.log("[safer] Safety rating:", { rating: normRating, ratingDate: normRatingDate, reviewType: normType, reviewDate: normReviewDate });
  return {
    safetyRating: normRating,
    safetyRatingDate: normRatingDate,
    reviewType: normType,
    reviewDate: normReviewDate,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getSAFERSnapshot(dot: string): Promise<SAFERSnapshot> {
  const url = `${SAFER_BASE}${encodeURIComponent(dot)}`;
  console.log(`[safer] Fetching ${url}`);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`SAFER HTTP error: ${res.status} ${res.statusText} for DOT ${dot}`);
  }

  const html = await res.text();

  // Detect "not found" — SAFER returns a page with no carrier name in the title
  if (
    html.includes("No records found") ||
    html.includes("Your search did not return any results") ||
    !html.includes("queryCarrierSnapshot")
  ) {
    throw new Error(`SAFER: carrier not found for DOT ${dot}`);
  }

  // ── Identity fields ────────────────────────────────────────────────────────

  // Legal name appears in <TITLE> as "SAFER Web - Company Snapshot <NAME>"
  // and also in the body in a querylabel row
  let legalName: string | null = null;
  const titleMatch = html.match(/<TITLE>SAFER Web - Company Snapshot ([^<]+)<\/TITLE>/i);
  if (titleMatch) {
    legalName = titleMatch[1].trim() || null;
  }
  // Prefer the body label row value (more reliable, no title truncation)
  const legalNameBody = extractAfterLabel(html, "Legal Name:");
  if (legalNameBody && legalNameBody !== "&nbsp;") {
    legalName = legalNameBody;
  }

  const dbaNameRaw = extractAfterLabel(html, "DBA Name:");
  const dbaName = (dbaNameRaw && dbaNameRaw !== "&nbsp;" && dbaNameRaw.trim() !== "") ? dbaNameRaw : null;

  // Entity Type
  const entityTypeRaw = extractAfterLabel(html, "Entity Type:");
  const entityType = entityTypeRaw || null;

  // USDOT Status (operating status)
  // The cell uses <!--ACTIVE-->  ACTIVE — strip comment
  let operatingStatus: string | null = null;
  const usdotStatusIdx = html.indexOf("USDOT Status:");
  if (usdotStatusIdx > -1) {
    const tdIdx = html.indexOf('class="queryfield"', usdotStatusIdx);
    if (tdIdx > -1) {
      const closeAngle = html.indexOf(">", tdIdx);
      const tdEnd = html.indexOf("</TD>", closeAngle);
      if (closeAngle > -1 && tdEnd > -1) {
        // Strip HTML comments and tags
        const raw = html.slice(closeAngle + 1, tdEnd)
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        operatingStatus = raw || null;
      }
    }
  }

  // Operating Authority Status — look for "Operating Authority Status:" label
  // The cell contains: "AUTHORIZED FOR Property" or "NOT AUTHORIZED" etc.
  let operatingAuthority: string | null = null;
  const oasIdx = html.indexOf("Operating Authority Status:");
  if (oasIdx > -1) {
    const tdIdx = html.indexOf('class="queryfield"', oasIdx);
    if (tdIdx > -1) {
      const closeAngle = html.indexOf(">", tdIdx);
      const tdEnd = html.indexOf("</TD>", closeAngle);
      if (closeAngle > -1 && tdEnd > -1) {
        // The cell may contain extra HTML (links, <br>, etc.) — strip everything
        // and take only the first meaningful line
        const raw = stripTags(html.slice(closeAngle + 1, tdEnd));
        // The authority text is at the start, e.g. "AUTHORIZED FOR Property For Licensing..."
        // Keep only the authority portion (before "For Licensing")
        const authMatch = raw.match(/^(AUTHORIZED FOR [A-Za-z\s,]+?|NOT AUTHORIZED|OUT-OF-SERVICE)/i);
        operatingAuthority = authMatch ? authMatch[1].trim() : (raw.split(/\s{2,}/)[0].trim() || null);
      }
    }
  }

  // ── MCS-150 ────────────────────────────────────────────────────────────────

  const mcs150DateRaw = extractAfterLabel(html, "MCS-150 Form Date:");
  const mcs150Date = normDate(mcs150DateRaw);

  // Mileage cell: "1,417,456 (2025)"
  let mcs150Mileage: number | null = null;
  let mcs150MileageYear: number | null = null;
  const mileageLabelIdx = html.indexOf("MCS-150 Mileage (Year):");
  if (mileageLabelIdx > -1) {
    const tdIdx = html.indexOf('class="queryfield"', mileageLabelIdx);
    // The mileage cell uses a different class pattern with color styling — fallback
    // to looking for the cell after the label regardless of class
    const searchFrom = mileageLabelIdx;
    const tdAnyIdx = html.indexOf("<TD", searchFrom + 20);
    if (tdAnyIdx > -1) {
      const tdClose = html.indexOf(">", tdAnyIdx);
      const tdEnd = html.indexOf("</TD>", tdClose);
      if (tdClose > -1 && tdEnd > -1) {
        const raw = stripTags(html.slice(tdClose + 1, tdEnd));
        // Pattern: "1,417,456 (2025)"
        const mileageMatch = raw.match(/([\d,]+)\s*\((\d{4})\)/);
        if (mileageMatch) {
          mcs150Mileage = parseIntSafe(mileageMatch[1]);
          mcs150MileageYear = parseInt(mileageMatch[2], 10);
        } else {
          // Just a plain number with no year
          mcs150Mileage = parseIntSafe(raw);
        }
      }
    }
    // If queryfield variant worked, it takes precedence
    if (tdIdx > -1 && tdIdx < (tdAnyIdx > -1 ? tdAnyIdx : Infinity)) {
      const tdClose2 = html.indexOf(">", tdIdx);
      const tdEnd2 = html.indexOf("</TD>", tdClose2);
      if (tdClose2 > -1 && tdEnd2 > -1) {
        const raw2 = stripTags(html.slice(tdClose2 + 1, tdEnd2));
        const mm = raw2.match(/([\d,]+)\s*\((\d{4})\)/);
        if (mm) {
          mcs150Mileage = parseIntSafe(mm[1]);
          mcs150MileageYear = parseInt(mm[2], 10);
        }
      }
    }
  }

  console.log("[safer] MCS-150:", { mcs150Date, mcs150Mileage, mcs150MileageYear });

  // ── Power Units and Drivers ────────────────────────────────────────────────

  // Power Units: standard label/value row
  const powerUnitsRaw = extractAfterLabel(html, "Power Units:");
  const powerUnits = parseIntSafe(powerUnitsRaw);

  // Drivers: nested in a sub-table within the Power Units row using a colored font cell
  // Pattern: >Drivers:</A></TH>\n          <TD ... color=#0000C0><B>45&nbsp;</TD>
  let drivers: number | null = null;
  const driversLabelIdx = html.indexOf("Drivers:");
  if (driversLabelIdx > -1) {
    // Find the next <TD after the Drivers label
    const dtdIdx = html.indexOf("<TD", driversLabelIdx);
    if (dtdIdx > -1) {
      const dtdClose = html.indexOf(">", dtdIdx);
      const dtdEnd = html.indexOf("</TD>", dtdClose);
      if (dtdClose > -1 && dtdEnd > -1) {
        drivers = parseIntSafe(stripTags(html.slice(dtdClose + 1, dtdEnd)));
      }
    }
  }

  console.log("[safer] Fleet:", { powerUnits, drivers });

  // ── Inspections ────────────────────────────────────────────────────────────

  const inspData = parseUSInspectionTable(html);

  // ── Crashes ────────────────────────────────────────────────────────────────

  const crashData = parseUSCrashTable(html);

  // ── Cargo ─────────────────────────────────────────────────────────────────

  const cargoTypes = parseCargoTypes(html);
  const hmFlag = cargoTypes.some((c) => /hazmat/i.test(c));

  // ── Safety Rating ──────────────────────────────────────────────────────────

  const safetyData = parseSafetyRating(html);

  // ── Summary log ───────────────────────────────────────────────────────────

  console.log("[safer] Snapshot parsed for DOT", dot, {
    legalName,
    entityType,
    operatingStatus,
    operatingAuthority,
    powerUnits,
    drivers,
    mcs150Date,
    mcs150Mileage,
    safetyRating: safetyData.safetyRating,
    reviewType: safetyData.reviewType,
    vehicleOosRate: inspData.vehicleOosRate,
    driverOosRate: inspData.driverOosRate,
    hazmatOosRate: inspData.hazmatOosRate,
    crashTow: crashData.crashTow,
    crashTotal: crashData.crashTotal,
    cargoTypes,
  });

  return {
    legalName,
    dbaName,
    entityType,
    operatingStatus,
    operatingAuthority,
    mcs150Date,
    mcs150MileageYear,
    mcs150Mileage,
    powerUnits,
    drivers,
    safetyRating: safetyData.safetyRating,
    safetyRatingDate: safetyData.safetyRatingDate,
    reviewType: safetyData.reviewType,
    reviewDate: safetyData.reviewDate,
    cargoTypes,
    hmFlag,
    vehicleInspections: inspData.vehicleInspections,
    vehicleOosCount: inspData.vehicleOosCount,
    vehicleOosRate: inspData.vehicleOosRate,
    driverInspections: inspData.driverInspections,
    driverOosCount: inspData.driverOosCount,
    driverOosRate: inspData.driverOosRate,
    hazmatInspections: inspData.hazmatInspections,
    hazmatOosCount: inspData.hazmatOosCount,
    hazmatOosRate: inspData.hazmatOosRate,
    crashFatal: crashData.crashFatal,
    crashInjury: crashData.crashInjury,
    crashTow: crashData.crashTow,
    crashTotal: crashData.crashTotal,
    parsedAt: new Date().toISOString(),
  };
}
