import { classifyBasicsCurrentness } from "./basics-currentness";
import type { BasicCategory } from "@/lib/supabase/types";

const CATEGORY_KEYS: Record<string, BasicCategory> = {
  UnsafeDriving: "unsafe_driving", CrashIndicator: "crash_indicator",
  HOSCompliance: "hos_compliance", VehicleMaint: "vehicle_maintenance",
  DrugsAlcohol: "controlled_substance", HMCompliance: "hazmat_compliance",
  DriverFitness: "driver_fitness",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

export function publicBasicProfileUrl(dotNumber: string): string {
  if (!/^[1-9]\d{0,8}$/.test(dotNumber)) throw new Error("A valid numeric USDOT number is required");
  return `https://ai.fmcsa.dot.gov/SMS/Carrier/${dotNumber}/CompleteProfile.aspx`;
}

/** Read-only public measures: never infer private percentiles, alerts or zeroes. */
export function parsePublicBasicMeasures(html: string, dotNumber: string, now = new Date()) {
  const sourceUrl = publicBasicProfileUrl(dotNumber);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  if (title.match(/U\.S\.\s*DOT#\s*(\d+)/i)?.[1] !== dotNumber) {
    throw new Error("Public SMS profile did not confirm the requested USDOT number");
  }
  const dateBlock = html.match(/<span\b[^>]*class="basicDates"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "";
  const date = text(dateBlock).match(/record ending (\w+) (\d{1,2}), (\d{4})/);
  if (!date || !MONTHS.includes(date[1])) throw new Error("Public SMS profile has no recognized BASIC release date");
  const isoDate = `${date[3]}-${String(MONTHS.indexOf(date[1]) + 1).padStart(2, "0")}-${date[2].padStart(2, "0")}`;
  const parsedDate = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== isoDate || parsedDate > now) {
    throw new Error("Public SMS profile has an invalid or future BASIC release date");
  }
  const list = html.match(/<ul\b[^>]*id="BASICList"[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  const categories = [...list.matchAll(/\/SMS\/Carrier\/(\d+)\/BASIC\/([A-Za-z]+)\.aspx/g)];
  const keys = categories.map((match) => CATEGORY_KEYS[match[2]]);
  if (categories.length !== 7 || new Set(keys).size !== 7 || keys.some((key) => !key) || categories.some((match) => match[1] !== dotNumber)) {
    throw new Error("Public SMS profile category headings changed or belong to another carrier");
  }
  const table = html.match(/<table\b[^>]*class="smsDetails"[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const row = table.match(/<tr\b[^>]*class="valueRow sumData"[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? "";
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
  if (cells.length !== 7) throw new Error("Public SMS profile does not contain seven matching measure cells");
  const measures = {} as Record<BasicCategory, { measure: number | null; percentile: null; alert: null; inspections_with_violations: null }>;
  cells.forEach((cell, index) => {
    const value = cell[1].match(/<span\b[^>]*class="val"[^>]*>([\s\S]*?)<\/span>\s*<label>\s*Measure\s*<\/label>/i)?.[1];
    let measure: number | null = null;
    if (value !== undefined) {
      if (!/^\d+(?:\.\d+)?$/.test(text(value))) throw new Error(`Invalid public measure for ${keys[index]}`);
      measure = Number(text(value));
      if (!Number.isFinite(measure)) throw new Error(`Non-finite public measure for ${keys[index]}`);
    } else if (!/^(Not Public|No Data|Insufficient Data|N\/A)$/i.test(text(cell[1]))) {
      throw new Error(`Unrecognized public measure cell for ${keys[index]}`);
    }
    measures[keys[index]] = { measure, percentile: null, alert: null, inspections_with_violations: null };
  });
  return { dotNumber, source: "public_sms_profile" as const, sourceUrl, smsRunDate: isoDate, ...classifyBasicsCurrentness(isoDate, now), measures };
}

type FetchDependencies = {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  logFailure?: (message: string, details: Record<string, unknown>) => void;
};

export async function fetchPublicBasicMeasures(dotNumber: string, dependencies: FetchDependencies = {}) {
  const url = publicBasicProfileUrl(dotNumber);
  const fetcher = dependencies.fetcher ?? fetch;
  const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const timeoutMs = dependencies.timeoutMs ?? 20_000;
  const logFailure = dependencies.logFailure ?? console.error;
  const backoff = [2_000, 6_000, 15_000];
  const failures: string[] = [];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) await sleep(backoff[attempt - 1]);
    let html: string;
    try {
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Public SMS profile request failed with HTTP ${response.status}`);
      // The request's abort signal remains active while the response body is read.
      html = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      failures.push(`attempt ${attempt + 1}: ${reason}`);
      logFailure("Public BASIC capture request failed", { dotNumber, attempt: attempt + 1, maxAttempts: 4, timeoutMs, reason });
      continue;
    }
    try {
      return parsePublicBasicMeasures(html, dotNumber);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logFailure("Public BASIC capture validation failed", { dotNumber, reason });
      throw error;
    }
  }
  throw new Error(`Public SMS capture failed for USDOT ${dotNumber} after 4 attempts: ${failures.join("; ")}`);
}
