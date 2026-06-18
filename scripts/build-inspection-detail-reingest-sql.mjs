import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseInspectionDetailXml } from "../lib/fmcsa/inspection-detail-xml.ts";

const [, , xmlPathArg, outPathArg, clientIdArg = "c009ad18-8acb-4fce-b001-2778879dc16e", dotNumberArg = "2533650"] = process.argv;

if (!xmlPathArg || !outPathArg) {
  console.error(
    "Usage: node --experimental-strip-types scripts/build-inspection-detail-reingest-sql.mjs <inspectionDetail.xml> <out.sql> [client_id] [dot_number]"
  );
  process.exit(1);
}

const xmlPath = path.resolve(xmlPathArg);
const outPath = path.resolve(outPathArg);
const xml = fs.readFileSync(xmlPath, "utf8");
const inspections = parseInspectionDetailXml(xml);
const clientId = clientIdArg.trim();
const dotNumber = dotNumberArg.trim();

const payload = JSON.stringify(inspections);
if (payload.includes("$payload$")) {
  throw new Error("Payload contains SQL dollar-quote delimiter");
}

const sql = `CREATE TEMP TABLE tmp_ingest_client ON COMMIT DROP AS
SELECT id AS client_id, dot_number
FROM public.clients
WHERE id = '${clientId}'::uuid
  AND dot_number = '${dotNumber}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tmp_ingest_client) THEN
    RAISE EXCEPTION 'Client % with DOT % was not found', '${clientId}', '${dotNumber}';
  END IF;
END$$;

CREATE TEMP TABLE tmp_violation_lookup ON COMMIT DROP AS
SELECT DISTINCT ON (regexp_replace(upper(violation_code), '[^A-Z0-9]', '', 'g'))
  regexp_replace(upper(violation_code), '[^A-Z0-9]', '', 'g') AS lookup_code,
  basic_category,
  severity_weight
FROM public.fmcsa_violation_reference
ORDER BY
  regexp_replace(upper(violation_code), '[^A-Z0-9]', '', 'g'),
  is_scored DESC,
  severity_weight DESC NULLS LAST;

CREATE TEMP TABLE tmp_inspection_detail_payload (
  data jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_inspection_detail_payload (data)
VALUES ($payload$${payload}$payload$::jsonb);

CREATE TEMP TABLE tmp_inspection_detail_rows ON COMMIT DROP AS
SELECT
  row_number() OVER () AS ordinal,
  item AS data,
  item->>'mcmisInspectionId' AS mcmis_inspection_id,
  item->>'reportNumber' AS report_number,
  item->>'state' AS state,
  (item->>'inspectionDate')::date AS inspection_date,
  item->>'startTime' AS start_time,
  item->>'endTime' AS end_time,
  item->>'level' AS level,
  item->>'locationText' AS location_text,
  item->>'facilityName' AS facility_name,
  item->>'postAccidentIndicator' AS post_accident_indicator,
  (item->>'timeWeight')::int AS time_weight,
  (item->>'totalViolations')::int AS total_violations,
  (item->>'oosViolations')::int AS oos_violations,
  item->'rawData' AS raw_data,
  item->'violations' AS violations,
  item->'vehicles' AS vehicles
FROM tmp_inspection_detail_payload p,
LATERAL jsonb_array_elements(p.data) item;

UPDATE public.inspections i
SET
  dot_number = c.dot_number,
  mcmis_inspection_id = r.mcmis_inspection_id,
  report_number = r.report_number,
  inspection_date = r.inspection_date,
  state = r.state,
  level = r.level,
  facility_name = r.facility_name,
  start_time = r.start_time,
  end_time = r.end_time,
  location_text = r.location_text,
  post_accident_indicator = r.post_accident_indicator,
  time_weight = r.time_weight,
  total_violations = r.total_violations,
  oos_violations = r.oos_violations,
  raw_data = r.raw_data
FROM tmp_inspection_detail_rows r, tmp_ingest_client c
WHERE i.client_id = c.client_id
  AND i.mcmis_inspection_id = r.mcmis_inspection_id;

INSERT INTO public.inspections (
  client_id,
  dot_number,
  mcmis_inspection_id,
  report_number,
  inspection_date,
  state,
  level,
  facility_name,
  start_time,
  end_time,
  location_text,
  post_accident_indicator,
  time_weight,
  total_violations,
  oos_violations,
  raw_data
)
SELECT
  c.client_id,
  c.dot_number,
  r.mcmis_inspection_id,
  r.report_number,
  r.inspection_date,
  r.state,
  r.level,
  r.facility_name,
  r.start_time,
  r.end_time,
  r.location_text,
  r.post_accident_indicator,
  r.time_weight,
  r.total_violations,
  r.oos_violations,
  r.raw_data
FROM tmp_inspection_detail_rows r
CROSS JOIN tmp_ingest_client c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inspections i
  WHERE i.client_id = c.client_id
    AND i.mcmis_inspection_id = r.mcmis_inspection_id
);

CREATE TEMP TABLE tmp_inspection_detail_map ON COMMIT DROP AS
SELECT
  r.ordinal,
  r.mcmis_inspection_id,
  r.report_number,
  r.violations,
  r.vehicles,
  i.id AS inspection_id,
  c.client_id
FROM tmp_inspection_detail_rows r
CROSS JOIN tmp_ingest_client c
JOIN public.inspections i
  ON i.client_id = c.client_id
 AND i.mcmis_inspection_id = r.mcmis_inspection_id;

DELETE FROM public.violations
WHERE inspection_id IN (
  SELECT inspection_id FROM tmp_inspection_detail_map
);

INSERT INTO public.violations (
  inspection_id,
  client_id,
  violation_code,
  violation_description,
  basic_category,
  severity_weight,
  time_weight,
  oos_violation,
  convicted,
  citation_number,
  citation_result,
  challengeable,
  challenge_reason,
  challenge_priority,
  ai_assessed_at
)
SELECT
  m.inspection_id,
  m.client_id,
  viol."violationCode",
  viol."violationDescription",
  l.basic_category,
  l.severity_weight,
  viol."timeWeight",
  viol."oosViolation",
  NULL::boolean,
  viol."citationNumber",
  viol."citationResult",
  NULL::boolean,
  NULL::text,
  NULL::challenge_priority,
  NULL::timestamptz
FROM tmp_inspection_detail_map m
CROSS JOIN LATERAL jsonb_to_recordset(m.violations) AS viol(
  "violationCode" text,
  "violationDescription" text,
  "oosViolation" boolean,
  "citationNumber" text,
  "citationResult" text,
  "timeWeight" int
)
LEFT JOIN tmp_violation_lookup l
  ON l.lookup_code = regexp_replace(upper(viol."violationCode"), '[^A-Z0-9]', '', 'g');

UPDATE public.inspections i
SET
  total_violations = counts.total_violations,
  oos_violations = counts.oos_violations
FROM (
  SELECT
    inspection_id,
    count(*)::int AS total_violations,
    count(*) FILTER (WHERE oos_violation)::int AS oos_violations
  FROM public.violations
  WHERE inspection_id IN (SELECT inspection_id FROM tmp_inspection_detail_map)
  GROUP BY inspection_id
) counts
WHERE i.id = counts.inspection_id;

DELETE FROM public.inspection_vehicles
WHERE inspection_id IN (
  SELECT inspection_id FROM tmp_inspection_detail_map
);

INSERT INTO public.inspection_vehicles (
  inspection_id,
  client_id,
  unit_number,
  unit_type,
  make,
  vin,
  license_plate,
  license_state,
  iep_dot
)
SELECT
  m.inspection_id,
  m.client_id,
  vehicle."unitNumber",
  vehicle."unitType",
  vehicle.make,
  vehicle.vin,
  vehicle."licensePlate",
  vehicle."licenseState",
  vehicle."iepDot"
FROM tmp_inspection_detail_map m
CROSS JOIN LATERAL jsonb_to_recordset(m.vehicles) AS vehicle(
  "unitNumber" int,
  "unitType" text,
  make text,
  vin text,
  "licensePlate" text,
  "licenseState" text,
  "iepDot" text
);
`;

fs.writeFileSync(outPath, sql);

const violationCount = inspections.reduce(
  (sum, inspection) => sum + inspection.violations.length,
  0
);
const oosCount = inspections.reduce(
  (sum, inspection) =>
    sum + inspection.violations.filter((violation) => violation.oosViolation).length,
  0
);
const citationCount = inspections.reduce(
  (sum, inspection) =>
    sum + inspection.violations.filter((violation) => violation.citationNumber).length,
  0
);
const vehicleCount = inspections.reduce(
  (sum, inspection) => sum + inspection.vehicles.length,
  0
);

console.log(
  JSON.stringify(
    {
      inspections: inspections.length,
      violations: violationCount,
      oosViolations: oosCount,
      citations: citationCount,
      vehicles: vehicleCount,
      outPath,
    },
    null,
    2
  )
);
