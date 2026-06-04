/**
 * SAFER Company Snapshot scraper
 * URL: https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=<DOT>
 *
 * No API key required — public FMCSA page.
 * Uses string-slice / regex parsing (no DOM parser available in serverless).
 *
 * HTML structure notes (verified 2026-06-03 against live SAFER page):
 *
 *   Fleet row layout (single TR):
 *     TH[Power Units:]  TD.queryfield[40]  TD[colspan=2 nested table:
 *       TH[Non-CMV Units:]  TD.queryfield[&nbsp;]
 *       TH[Drivers:]        TD[<FONT color=...><B>45]   ← NOT queryfield class
 *     ]
 *   So: power_units = first queryfield TD after "Power Units:" label
 *       drivers     = first TD (any class) directly after "Drivers:" label
 *       (the Non-CMV TD IS queryfield but blank; the Drivers TD uses FONT styling)
 *
 *   MCS-150 row (single TR):
 *     TH[MCS-150 Form Date:]  TD.queryfield[MM/DD/YYYY]
 *     TH[MCS-150 Mileage (Year):]  TD[<FONT><B>1,417,456 (2025)]  ← NOT queryfield
 *
 *   Inspection table: summary="Inspections", columns: Vehicle, Driver, Hazmat, IEP
 *     Rows: "Inspections" | "Out of Service" | "Out of Service %"
 *     OOS% cells have leading/trailing whitespace around the percentage string.
 *
 *   Crash table: summary="Crashes" (US section only — before CAInspections anchor)
 *     Row: "Crashes", columns: Fatal, Injury, Tow, Total
 *
 *   Safety rating: table summary="Review Information"
 *   Cargo table: summary="Cargo Carried" — checked items: <TD>X</TD><TD>CARGO NAME</TD>
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

  saferAsOf: string | null; // YYYY-MM-DD — "Data current as of MM/DD/YYYY" from page header
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
 *
 * Used for standard label/value pairs where the value TD has class="queryfield".
 */
function extractAfterLabel(html: string, label: string): string | null {
  const idx = html.indexOf(label);
  if (idx === -1) return null;
  const tdIdx = html.indexOf('class="queryfield"', idx);
  if (tdIdx === -1) return null;
  const closeAngle = html.indexOf(">", tdIdx);
  if (closeAngle === -1) return null;
  const tdEnd = html.indexOf("</TD>", closeAngle);
  if (tdEnd === -1) return null;
  return stripTags(html.slice(closeAngle + 1, tdEnd));
}

/**
 * Extract text from the first <TD> cell (any class) that directly follows the
 * given label string in the HTML. Used for cells that use <FONT color=...>
 * styling instead of class="queryfield" (e.g. Drivers, MCS-150 Mileage).
 */
function extractAfterLabelAnyTD(html: string, label: string): string | null {
  const idx = html.indexOf(label);
  if (idx === -1) return null;
  // Find the end of the TH that contains the label (</TH>)
  const thEnd = html.indexOf("</TH>", idx);
  if (thEnd === -1) return null;
  // Find the next <TD after the TH closes
  const tdIdx = html.indexOf("<TD", thEnd);
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
 *
 * Implementation note: the regex <TH[^>]*>[\s\S]*?{rowLabel}[\s\S]*?</TH> uses
 * [\s\S]*? to span across preceding column-header THs in the same row, landing
 * on the data-row TH that contains rowLabel. afterTh then starts at the data
 * cells for that row, and nextRowIdx clips at the closing </TR>.
 */
function extractTableRow(tableHtml: string, rowLabel: string): string[] {
  const thPattern = rowLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thMatch = new RegExp(`<TH[^>]*>[\\s\\S]*?${thPattern}[\\s\\S]*?</TH>`, "i").exec(tableHtml);
  if (!thMatch) return [];

  const afterTh = tableHtml.slice(thMatch.index + thMatch[0].length);

  const nextRowIdx = afterTh.search(/<\/TR>/i);
  const rowContent = nextRowIdx > -1 ? afterTh.slice(0, nextRowIdx) : afterTh.slice(0, 2000);

  const cells: string[] = [];
  const tdRegex = /<TD[^>]*class="queryfield"[^>]*>([\s\S]*?)<\/TD>/gi;
  let m: RegExpExecArray | null;
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
 *
 * Note: OOS% cells contain whitespace-padded values like "\n         20%\n       ".
 * stripTags + trim handles this correctly.
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
  // Slice before Canada section to avoid parsing the Canadian table
  const caAnchor = html.indexOf('name="CAInspections"');
  const usSection = caAnchor > -1 ? html.slice(0, caAnchor) : html;

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
 * Row: "Crashes", columns: Fatal, Injury, Tow, Total
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

  const ratingDate = extractAfterLabel(tableHtml, "Rating Date:");
  const reviewDate = extractAfterLabel(tableHtml, "Review Date:");
  const rating = extractAfterLabel(tableHtml, 'class="querylabelbkg">Rating:');
  const reviewType = extractAfterLabel(tableHtml, 'class="querylabelbkg">Type:');

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

  let legalName: string | null = null;
  const titleMatch = html.match(/<TITLE>SAFER Web - Company Snapshot ([^<]+)<\/TITLE>/i);
  if (titleMatch) {
    legalName = titleMatch[1].trim() || null;
  }
  // Body label row is more reliable (no title truncation)
  const legalNameBody = extractAfterLabel(html, "Legal Name:");
  if (legalNameBody && legalNameBody !== "&nbsp;") {
    legalName = legalNameBody;
  }

  const dbaNameRaw = extractAfterLabel(html, "DBA Name:");
  const dbaName = (dbaNameRaw && dbaNameRaw !== "&nbsp;" && dbaNameRaw.trim() !== "") ? dbaNameRaw : null;

  const entityTypeRaw = extractAfterLabel(html, "Entity Type:");
  const entityType = entityTypeRaw || null;

  // USDOT Status — cell may contain HTML comments like <!--ACTIVE-->
  let operatingStatus: string | null = null;
  const usdotStatusIdx = html.indexOf("USDOT Status:");
  if (usdotStatusIdx > -1) {
    const tdIdx = html.indexOf('class="queryfield"', usdotStatusIdx);
    if (tdIdx > -1) {
      const closeAngle = html.indexOf(">", tdIdx);
      const tdEnd = html.indexOf("</TD>", closeAngle);
      if (closeAngle > -1 && tdEnd > -1) {
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

  // Operating Authority Status
  let operatingAuthority: string | null = null;
  const oasIdx = html.indexOf("Operating Authority Status:");
  if (oasIdx > -1) {
    const tdIdx = html.indexOf('class="queryfield"', oasIdx);
    if (tdIdx > -1) {
      const closeAngle = html.indexOf(">", tdIdx);
      const tdEnd = html.indexOf("</TD>", closeAngle);
      if (closeAngle > -1 && tdEnd > -1) {
        const raw = stripTags(html.slice(closeAngle + 1, tdEnd));
        const authMatch = raw.match(/^(AUTHORIZED FOR [A-Za-z\s,HHG]+?)(?:\s+For |\s+click |\s*$)/i)
          ?? raw.match(/^(NOT AUTHORIZED|OUT-OF-SERVICE)/i);
        operatingAuthority = authMatch ? authMatch[1].trim() : (raw.slice(0, 40).trim() || null);
      }
    }
  }

  // ── MCS-150 ────────────────────────────────────────────────────────────────

  // MCS-150 Form Date: uses standard queryfield TD — extractAfterLabel works.
  const mcs150DateRaw = extractAfterLabel(html, "MCS-150 Form Date:");
  const mcs150Date = normDate(mcs150DateRaw);

  // MCS-150 Mileage (Year): the value TD uses <FONT color=...> NOT queryfield.
  // Use extractAfterLabelAnyTD which finds the TD immediately after the </TH>.
  let mcs150Mileage: number | null = null;
  let mcs150MileageYear: number | null = null;
  const mileageRaw = extractAfterLabelAnyTD(html, "MCS-150 Mileage (Year):");
  if (mileageRaw) {
    // Pattern: "1,417,456 (2025)" or just a plain number
    const mileageMatch = mileageRaw.match(/([\d,]+)\s*\((\d{4})\)/);
    if (mileageMatch) {
      mcs150Mileage = parseIntSafe(mileageMatch[1]);
      mcs150MileageYear = parseInt(mileageMatch[2], 10);
    } else {
      mcs150Mileage = parseIntSafe(mileageRaw);
    }
  }

  console.log("[safer] MCS-150:", { mcs150Date, mcs150Mileage, mcs150MileageYear });

  // ── Power Units and Drivers ────────────────────────────────────────────────
  //
  // HTML layout (single TR):
  //   TH[Power Units:]  TD.queryfield[value]  TD[colspan=2 nested table:
  //     TH[Non-CMV Units:]  TD.queryfield[&nbsp;]
  //     TH[Drivers:]        TD[<FONT color=...><B>value]  ← no queryfield class
  //   ]
  //
  // power_units: first queryfield TD after "Power Units:" label — extractAfterLabel.
  // drivers: the TD immediately after the "Drivers:" </TH> uses FONT styling,
  //          not queryfield class. Use extractAfterLabelAnyTD.

  const powerUnitsRaw = extractAfterLabel(html, "Power Units:");
  const powerUnits = parseIntSafe(powerUnitsRaw);
  if (powerUnits === null) {
    throw new Error(`[safer] Failed to extract power_units for DOT ${dot}`);
  }

  const driversRaw = extractAfterLabelAnyTD(html, "Drivers:");
  const drivers = parseIntSafe(driversRaw);
  if (drivers === null) {
    throw new Error(`[safer] Failed to extract drivers for DOT ${dot}`);
  }

  console.log(`[safer] power_units=${powerUnits}, drivers=${drivers}, mcs150_date=${mcs150Date}, mcs150_mileage=${mcs150Mileage}, mcs150_mileage_year=${mcs150MileageYear}`);

  // ── Inspections ────────────────────────────────────────────────────────────

  const inspData = parseUSInspectionTable(html);

  // ── Crashes ────────────────────────────────────────────────────────────────

  const crashData = parseUSCrashTable(html);

  // ── Cargo ─────────────────────────────────────────────────────────────────

  const cargoTypes = parseCargoTypes(html);
  const hmFlag = cargoTypes.some((c) => /hazmat/i.test(c));

  // ── Safety Rating ──────────────────────────────────────────────────────────

  const safetyData = parseSafetyRating(html);

  // ── SAFER "as of" date ────────────────────────────────────────────────────
  // The SAFER page contains text like "Data current as of 06/03/2026"
  // We extract and normalize it to YYYY-MM-DD.
  let saferAsOf: string | null = null;
  const asOfMatch = html.match(/[Dd]ata\s+current\s+as\s+of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)
    ?? html.match(/as\s+of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (asOfMatch) {
    saferAsOf = normDate(asOfMatch[1]);
  }
  console.log("[safer] saferAsOf:", saferAsOf);

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
    mcs150MileageYear,
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
    saferAsOf,
    parsedAt: new Date().toISOString(),
  };
}
