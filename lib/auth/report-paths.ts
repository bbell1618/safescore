const REPORT_ID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const STAFF_REPORT_ACTION_PATH = new RegExp(
  `^/api/reports/${REPORT_ID_SEGMENT}(?:/send)?$`,
  "i"
);

export function isStaffReportActionPath(path: string): boolean {
  return STAFF_REPORT_ACTION_PATH.test(path);
}
