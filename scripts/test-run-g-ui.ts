import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const publicPage = read("app/(public)/roster/[token]/page.tsx");
const wizard = read("components/roster/roster-wizard.tsx");
const compliancePage = read(
  "app/(console)/console/clients/[id]/compliance/page.tsx"
);
const reviewStrip = read(
  "components/console/compliance/roster-review-strip.tsx"
);
const requestControl = read(
  "components/console/compliance/roster-request-control.tsx"
);
const requestQueue = read(
  "app/(console)/console/clients/[id]/requests/page.tsx"
);
const portalDocuments = read("app/(portal)/portal/documents/page.tsx");
const portalCompliance = read("app/(portal)/portal/compliance/page.tsx");
const checklist = read("components/console/operator-checklist.tsx");

assert.match(publicPage, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
assert.match(publicPage, /referrer:\s*"no-referrer"/);
assert.match(publicPage, /<RosterWizard token=\{token\}/);
assert.match(publicPage, /portal-brand-root/);

for (const field of [
  "full_name",
  "cdl_number",
  "cdl_state",
  "cdl_class",
  "cdl_expiry",
  "medical_cert_expiry",
  "hired_date",
]) {
  assert.ok(wizard.includes(field), `wizard missing ${field}`);
}
assert.match(wizard, /cdl_state:\s*"CA"/);
assert.match(wizard, /cdl_class:\s*"A"/);
assert.equal((wizard.match(/capture="environment"/g) ?? []).length, 1);
assert.match(wizard, /accept="image\/\*,application\/pdf"/);
assert.match(wizard, /Snap a photo — we&apos;ll read the dates for you/);
assert.match(wizard, /Drivers added \(\{collection\.drivers\.length\}\)/);
assert.match(wizard, /That’s everyone — submit roster/);
assert.match(wizard, /Add or correct a driver/);
assert.match(wizard, /Reviewed by GEIA/);
assert.match(wizard, /document\.reviewStatus === "reviewed"/);
assert.match(wizard, /if \(savedDriver\) setEditingId\(savedDriver\.id\)/);
assert.match(wizard, /if \(docType === "cdl"\) setCdlPhoto\(null\)/);
assert.match(wizard, /This driver-list link is no longer available/);

for (const routeContract of [
  "`/api/roster/${token}`",
  "`/api/roster/${token}/drivers`",
  "`/api/roster/${token}/drivers/${driverId}/documents`",
  "`/api/roster/${token}/drivers/${driver.id}`",
  "`/api/roster/${token}/submit`",
]) {
  assert.ok(wizard.includes(routeContract), `wizard missing ${routeContract}`);
}
assert.match(wizard, /method:\s*editingId \? "PATCH" : "POST"/);
assert.match(wizard, /method:\s*"DELETE"/);
assert.doesNotMatch(wizard, /server-only|createServiceClient|SUPABASE_SERVICE_ROLE_KEY/);

assert.match(compliancePage, /source, approved_at, approved_by, request_id, notes/);
assert.match(compliancePage, /driver\.approved_at !== null/);
assert.match(compliancePage, /driver\.source === "client_portal" && driver\.approved_at === null/);
assert.match(compliancePage, /<RosterRequestControl/);
assert.match(compliancePage, /<RosterReviewStrip/);
assert.match(reviewStrip, /id="client-submissions-pending-review"/);
assert.match(reviewStrip, /Approve into roster/);
assert.match(reviewStrip, /Close roster request/);
assert.match(reviewStrip, /method:\s*"PATCH"/);
assert.match(reviewStrip, /method:\s*"DELETE"/);
assert.match(
  reviewStrip,
  /driver-roster-request\/\$\{request\.id\}\/close/
);
assert.match(requestControl, /Request driver roster/);
assert.match(requestControl, /driver-roster-request/);
assert.match(requestControl, /<RosterLinkCopy/);
assert.match(requestControl, /if \(payload\.request\?\.id && payload\.rosterUrl\)/);
assert.match(requestControl, /Request saved, but its notification failed/);
assert.match(compliancePage, /key=\{openRosterRequest\?\.id \?\? "no-open-roster-request"\}/);

assert.match(requestQueue, /request_type, upload_token/);
assert.match(requestQueue, /row\.request_type === "roster_collection"/);
assert.match(requestQueue, /<RosterLinkCopy/);

assert.match(portalDocuments, /"evidence" \| "question" \| "roster_collection"/);
assert.match(portalDocuments, /upload_token, submitted_at/);
assert.match(portalDocuments, /isRosterCollection/);
assert.match(portalDocuments, /href=\{`\/roster\/\$\{request\.upload_token\}`\}/);
assert.match(portalDocuments, /!isRosterCollection &&/);
assert.match(portalCompliance, /\.not\("approved_at", "is", null\)/);

assert.match(checklist, /request_driver_roster/);
assert.match(checklist, /copy_roster_link/);
assert.match(checklist, /navigator\.clipboard\.writeText\(item\.action\.value\)/);
assert.match(checklist, /driver-roster-request/);
assert.match(checklist, /payload\.request\?\.id && payload\.rosterUrl/);

console.log(
  JSON.stringify(
    {
      passed: true,
      publicWizard: {
        onePage: true,
        resumable: true,
        mobilePhotoCapture: true,
        tokenScopedEndpoints: 5,
      },
      console: {
        requestControl: true,
        pendingReview: true,
        explicitClose: true,
        approvedOnlyOfficialRoster: true,
      },
      portal: {
        rosterCardUsesTokenWizard: true,
        genericRequestUploadExcluded: true,
        complianceApprovedOnly: true,
      },
      checklistActions: true,
    },
    null,
    2
  )
);
