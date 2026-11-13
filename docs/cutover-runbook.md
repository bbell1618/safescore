# SafeScore cutover runbook: move the live app onto the GoldenDesk database

Written November 13, 2026 (QF-199). Applies after Phases 0–5 of the SafeScore plan. This replaces the database section of the older launch-runbook.md.

## What the cutover does

SafeScore (safescore.vercel.app) stays carrier-facing. Its data moves from the old Supabase project (kzndtvkblfbrsnrnjodf) to schema `safescore` in the GoldenDesk project (pkrzpyqdrtcvfnuvzriv), so GoldenDesk's SafeScore section and the carrier site read and write one set of tables. The app is repointed by environment variables only. No code change is needed.

Already in place before cutover:

- Full copy of the old database in schema `safescore` (49 tables, 4,596 rows at copy time, 2026-11-13), plus storage buckets prefixed `safescore-`.
- App support for the new database: schema from NEXT_PUBLIC_SUPABASE_DB_SCHEMA, bucket prefix from NEXT_PUBLIC_SAFESCORE_BUCKET_PREFIX, carrier logins on the role `safescore_authenticated` (no access to GoldenDesk tables).
- Approval cards created in GoldenDesk by trigger on `safescore.outbound_queue`; the carrier-side sender sends approved rows only when SAFESCORE_SENDER_ENABLED is "true".
- Platform state key `engine_source` is {"database":"old"} until the switch (drives warnings and locking in GoldenDesk).

## Who does what

Brandon only (Claude cannot do these):

1. In the SafeScore Vercel project, Settings, Environment Variables, Production, set these six and leave everything else as is:
   - NEXT_PUBLIC_SUPABASE_URL = GoldenDesk project URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = GoldenDesk project publishable (anon) key
   - SUPABASE_SERVICE_ROLE_KEY = GoldenDesk project service role key
   - NEXT_PUBLIC_SUPABASE_DB_SCHEMA = safescore
   - NEXT_PUBLIC_SAFESCORE_BUCKET_PREFIX = safescore-
   - SAFESCORE_SENDER_ENABLED = true
2. Redeploy production (Deployments, latest, Redeploy). Say "switched" in the chat.

Claude, after "switched":

3. Flip platform state `engine_source` to {"database":"gd"}.
4. Run the delta re-sync (below) so anything written to the old database after the 2026-11-13 copy is carried over.
5. Run the verification list (below) and report pass/fail.
6. Make the old database read-only (revoke insert, update and delete from `authenticated`, `anon` on its public tables, and flip the app's old service key out of use). Keep it for 30 days for rollback, then Brandon deletes the project.

## Delta re-sync

Why after the switch: once the app points at the new database the old one stops receiving writes, so the delta is complete and cannot race. Rows written to the new database after the switch win over older old-database rows.

Rules the delta follows: insert rows that exist only in the old database; update rows where the old row's updated_at is newer; never delete; skip `login_codes` (one-time codes only).

Steps (Claude):

1. Redeploy the two one-time functions from `geia-ams/supabase/qf196-safescore-move/` (`ss-export.ts.txt` into the old project, `ss-import.ts.txt` into the GoldenDesk project) with a fresh token hash. Remove the .txt ending when deploying.
2. For each table from the exporter's `tables` operation, call the importer with stage `delta` and the table name. Record inserted and updated counts.
3. Compare counts old versus new per table (new must be at least old, except login_codes).
4. Replace both functions with inert stubs (HTTP 410) again.

Known limit: a row deleted in the old database after the copy is not deleted in the new one. The delta report lists per-table counts so a mismatch of that kind shows up and can be cleaned by hand.

## Verification after cutover

Pass means every line below is true. Claude runs them and posts the table.

1. A carrier link (practice carrier) loads over the new database: plan page, portal, driver list.
2. Code sign-in works end to end: request a code, email arrives from info@, code opens the portal.
3. Carrier A cannot read carrier B: `set role safescore_authenticated` with carrier A's JWT claims returns zero rows for carrier B in clients, drivers, reports.
4. A carrier login cannot read any GoldenDesk table (permission denied on `public`).
5. Approve a test card in GoldenDesk, within 5 minutes the sender marks it sent and the email lands (this is the first real proof the sender cron fires; before cutover it is unverified because the sender is off).
6. An unapproved card never sends. A rejected card never sends. Approving twice sends once.
7. Expired or wrong plan link shows the plain "link no longer works" page, not an error.
8. GoldenDesk SafeScore Today and Health show no "old database" warning and no stale jobs; the hourly health check opens no task.
9. Files: open a report and an uploaded document from a carrier that had them before the move.

## If something fails (rollback)

Set the six Vercel variables back to the old project's values (kept in the Vercel project history) and redeploy. Set `engine_source` back to {"database":"old"}. Anything written to the new database since the switch is still there and can be carried back with the same delta steps in the other direction. Tell Claude which check failed first.

## Things that are not part of this cutover

- The old Inbox "approve" path in the SafeScore console still sends directly on the old database. After cutover, approvals happen only in GoldenDesk; leave the console Inbox unused. Retiring /console and /staff waits until GoldenDesk can work cases.
- Custom domain safescore.goldenerainsurance.com (Vercel domain plus a CNAME at the DNS provider) and making the GitHub repo private are Brandon-only and independent of this cutover.
- Storage access policies for `safescore-` buckets: the app reads files with the service client, so none are needed today. Add them if the app ever reads files with a carrier login.
