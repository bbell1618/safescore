import { readFileSync, writeFileSync } from "node:fs";

const seedPath = "supabase/seeds/fmcsa_appendixa_seed.sql";
const sourceVersion =
  "Safety Measurement System (SMS) Methodology Appendix A - Version 3.20; Revised July 2025";

const categoryByBasic = new Map([
  ["Unsafe Driving", "unsafe_driving"],
  ["Hours-of-Service (HOS) Compliance", "hos_compliance"],
  ["Hours-of-Service Compliance", "hos_compliance"],
  ["HOS Compliance", "hos_compliance"],
  ["Driver Fitness", "driver_fitness"],
  ["Controlled Substances/Alcohol", "controlled_substance"],
  ["Vehicle Maintenance", "vehicle_maintenance"],
  ["Hazardous Materials (HM) Compliance", "hazmat_compliance"],
  ["Hazardous Materials Compliance", "hazmat_compliance"],
  ["HM Compliance", "hazmat_compliance"],
  ["Insurance/Other", null],
]);

const quote = (value) => (value == null ? "NULL" : `$v$${value}$v$`);
const enumLiteral = (value) =>
  value == null ? "NULL::public.basic_category" : `$v$${value}$v$::public.basic_category`;

function splitValues(tuple) {
  const values = [];
  let i = 0;

  while (i < tuple.length) {
    while (tuple[i] === " " || tuple[i] === ",") i += 1;
    if (tuple.startsWith("$v$", i)) {
      const end = tuple.indexOf("$v$", i + 3);
      if (end === -1) throw new Error(`Unclosed dollar quote in ${tuple}`);
      values.push(tuple.slice(i + 3, end));
      i = end + 3;
    } else {
      const nextComma = tuple.indexOf(",", i);
      const end = nextComma === -1 ? tuple.length : nextComma;
      values.push(tuple.slice(i, end).trim());
      i = end;
    }
  }

  return values;
}

const sql = readFileSync(seedPath, "utf8");
const insertStart = sql.indexOf("INSERT INTO public.fmcsa_violation_reference");
if (insertStart === -1) throw new Error("Could not find seed INSERT");

const comments = sql.slice(0, insertStart);
const valueSectionStart = sql.indexOf("VALUES", insertStart);
const conflictStart = sql.indexOf("ON CONFLICT", valueSectionStart);
if (valueSectionStart === -1 || conflictStart === -1) {
  throw new Error("Could not find seed VALUES/ON CONFLICT sections");
}

const rowLines = sql
  .slice(valueSectionStart + "VALUES".length, conflictStart)
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("("));

const unmapped = new Map();
const rows = rowLines.map((line) => {
  const trimmed = line.trim().replace(/,\s*$/, "");
  const tuple = trimmed.slice(1, -1);
  const values = splitValues(tuple);
  if (values.length !== 8) {
    throw new Error(`Expected 8 seed values, found ${values.length}: ${line}`);
  }

  const [
    violationCode,
    violationGroup,
    description,
    fmcsaBasic,
    severityWeight,
    oosEligible,
    acuteCritical,
    rowSourceVersion,
  ] = values;

  if (rowSourceVersion !== sourceVersion) {
    throw new Error(`Unexpected source version for ${violationCode}: ${rowSourceVersion}`);
  }

  if (!categoryByBasic.has(fmcsaBasic)) {
    unmapped.set(fmcsaBasic, (unmapped.get(fmcsaBasic) ?? 0) + 1);
  }

  const basicCategory = categoryByBasic.get(fmcsaBasic) ?? null;
  const isScored = basicCategory !== null && severityWeight !== "NULL";

  return [
    quote(violationCode),
    quote(violationGroup === "NULL" ? null : violationGroup),
    quote(description),
    quote(fmcsaBasic),
    enumLiteral(basicCategory),
    severityWeight,
    oosEligible,
    quote(acuteCritical === "NULL" ? null : acuteCritical),
    isScored ? "TRUE" : "FALSE",
    quote(rowSourceVersion),
  ];
});

if (unmapped.size > 0) {
  const details = [...unmapped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([basic, count]) => `${basic}: ${count}`)
    .join("\n");
  throw new Error(`Unmapped fmcsa_basic values:\n${details}`);
}

const output = `${comments}INSERT INTO public.fmcsa_violation_reference
  (violation_code, violation_group, description, fmcsa_basic, basic_category, severity_weight, oos_eligible, acute_critical, is_scored, source_version)
VALUES
${rows.map((row, index) => `  (${row.join(", ")})${index === rows.length - 1 ? "" : ","}`).join("\n")}
ON CONFLICT (violation_code) DO UPDATE SET
  violation_group = EXCLUDED.violation_group,
  description     = EXCLUDED.description,
  fmcsa_basic     = EXCLUDED.fmcsa_basic,
  basic_category  = EXCLUDED.basic_category,
  severity_weight = EXCLUDED.severity_weight,
  oos_eligible    = EXCLUDED.oos_eligible,
  acute_critical  = EXCLUDED.acute_critical,
  is_scored       = EXCLUDED.is_scored,
  source_version  = EXCLUDED.source_version,
  updated_at      = now();
`;

writeFileSync(seedPath, output);
console.log(`Regenerated ${seedPath} with ${rows.length} rows.`);
