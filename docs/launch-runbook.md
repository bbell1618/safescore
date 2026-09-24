# SafeScore launch runbook

Updated September 23, 2026, Pass 5. GoldenDesk project e642d966-a374-4317-8b10-6c9a003ffb67 is the official record. Production: https://safescore.vercel.app. Vercel: safescore / prj_Pz8HKt8vV7P8EQPEA4bjDLizZ0Xb. Supabase: kzndtvkblfbrsnrnjodf.

Keep EMAIL_DRY_RUN exactly true and Stripe TEST during this pass. Future live switches belong to the named humans; this document does not authorize Codex to send real email, charge anyone, file a case, accept terms, touch live Stripe keys, or modify existing Nationwide rows. READY is deployment evidence, not launch sign-off.

## Current gates

| Gate | Status | Owner | One action that closes it |
|---|---|---|---|
| Runtime email suppression | VERIFIED literal true in signed-in /console/email-safety | Brandon | Retain true until the approved human email cutover. |
| Staff dry-run outbox and auth-link logging | Implemented; live RLS/staff proof in Pass 4; logging block count 1→0 | Codex | Retain the outbox and no-token-log regression checks. |
| Safe first-send tool | Implemented in Pass 5; production dry-run receipt recorded in the pass report | Brandon | After approved SMTP setup, perform one human internal-inbox delivery test using /staff/outbox. |
| SMTP and hosted recovery template | OPEN; real delivery NOT VERIFIED | Brandon | Record successful delivery/reply and approved recovery-template evidence for the approved work sender. |
| Stripe LIVE | OPEN; remains TEST | Brandon | Complete docs/stripe-go-live.md and record the no-charge live Checkout receipt. |
| Actual live payment/fulfillment | NOT VERIFIED by an unpaid checkout | Brandon | Record a separately authorized successful payment and its verified webhook/fulfillment outcome. |
| DNS and production callback hostname | OPEN | Brandon / domain administrator | Record HTTPS and sign-in/reset/Checkout callback proof on the approved hostname. |
| Terms and filing authorization | Draft only; approval OPEN | Daven | Record approval or required edits in task 674966a4-666a-4fc2-b088-baa207ee4674. |
| Cron secret and scheduled monitoring | Brandon reports secret set/redeploy; next scheduled success has no log yet | Brandon | Record the next scheduled invocation's log and its error-free per-client result. |
| Nationwide public BASIC capture | VERIFIED duplicate-preserving capture: 2026-08-28, original row unchanged | Codex / Brandon | Observe a future genuine newer release inserted once; preserve existing rows. |
| Pass 4 portal proof and cleanup | User reports finished; live-state discrepancy: TEST client still present at Pass 5 preflight | Brandon | Reconcile the completion receipt with live fixture/auth/child/outbox state before calling cleanup verified. |
| Punch list 03a82cde items 1–5 | Code/tests complete; actual cron/send/provider operation has separate gates | Codex | Keep regression checks passing; recorded as completed subtasks. |
| Secure DataQs credential handoff (03a82cde #6) | PARKED | Daven | Choose the credential vault/encryption design and key owner. |
| SOP findings 1303890d 1–8 | Previously shipped; rechecked source/tests; completed subtasks recorded | Codex | Keep report/queue/import/PAR regression checks passing. |
| Recovery-template timing | PARKED with SMTP | Brandon | Review the hosted recovery template during sender setup. |
| Exact DataQs menu crosswalk | PARKED until real filing | Brandon | Capture labels during the next independently authorized real filing. |
| LexisNexis provider proof / Lane A | Existing provider credentialing/manual-order hold remains separate | Brandon | Record a provider-approved scoped delivery proof when credentialing is ready. |
| Historical import correction | Prior date-join concern; protected rows unchanged | Brandon | Record a specific additive correction scope or accepted deferral. |
| Access, AI funding and recovery ownership | Prior governance items require owner evidence | Brandon | Record approved access, funding, backup/incident/rollback owners in GoldenDesk. |
| Outside-client launch approval | OPEN | Daven | Record final launch approval after required gates pass. |

The Pass 5 report carries commit/deployment IDs, actual receipts and open discrepancies. A user-reported completion is attributed as such; it is not substituted for contradictory live data.

## Email: configure safely, then let a human prove delivery

1. Open Vercel → safescore → Settings → Environment Variables → Production.
2. Confirm EMAIL_DRY_RUN is exactly true.
3. Configure SMTP_HOST for the approved provider.
4. Configure SMTP_PORT for that provider.
5. Configure SMTP_USER for the approved work sender.
6. Store SMTP_PASSWORD or GMAIL_APP_PASSWORD through secure controls.
7. Set SMTP_SECURE to match the provider's TLS requirements.
8. Set SMTP_FROM to the approved sender address.
9. Set EMAIL_REPLY_TO to the approved work reply mailbox.
10. Review Supabase Authentication → Email templates → recovery with the approved copy in task 478f2406-7946-4093-aa43-51c343ce9f39.
11. Configure Supabase custom SMTP separately if that hosted recovery flow is used.
12. Redeploy production.
13. Verify /console/email-safety still says exactly true.
14. Open /staff/outbox as staff.
15. Select brandonbell@goldenerainsurance.com or operations@goldenerainsurance.com.
16. Click Send test email once.
17. Record the dry_run response/outbox ID and verify that nothing was delivered.
18. Obtain the separately recorded human email activation decision.
19. Have the authorized human change EMAIL_DRY_RUN to false.
20. Redeploy production.
21. Have that human send one fixed test using /staff/outbox.
22. Have the recipient confirm delivery and reply routing.
23. Record the provider message ID plus recipient confirmation in GoldenDesk.

The staff test endpoint is POST /api/staff/email-test with JSON {"to":"one exact allowed address"}. It rejects arbitrary recipients/content/CC/BCC. Only the literal true uses its outbox branch; ANY other value selects SMTP, as requested. The page displays that mode. Ordinary application email retains its separate fail-closed rule (SMTP only for normalized false). Keep the literal setting precise. A provider message ID proves SMTP acceptance, not inbox delivery. If delivery fails, retain the real error and return to dry-run/redeploy; do not repeatedly click. Never use bbell1618@.

## Stripe and domain

Follow [Stripe go-live steps](stripe-go-live.md). All seven Stripe variables and exact no-charge proof are listed there. Do not conflate an unpaid session with successful payment fulfillment. Assessment waivers are staff-audited and cover only the one-time fee.

1. Record the intended launch hostname in GoldenDesk.
2. Add the approved hostname to the safescore Vercel project's Domains page.
3. Create exactly the DNS records that Vercel provides.
4. Wait for the HTTPS certificate to be valid.
5. Set NEXT_PUBLIC_APP_URL to that HTTPS hostname.
6. Add the intended callback origins in Supabase Authentication URL configuration.
7. Update the Stripe endpoint/return URLs using the Stripe procedure.
8. Redeploy production.
9. Verify public pages and sign-in/reset redirects on the approved hostname.
10. Verify invite, report and unpaid Checkout return links use that hostname.

## Cron schedule and evidence

vercel.json contains two entries for the same authenticated GET /api/cron/monitoring-refresh:

| UTC expression | Daylight time (PDT) | Standard time (PST) | Behavior |
|---|---|---|---|
| 0 13 * * * | 6:00 AM daily | 5:00 AM daily | Active during PDT; skipped in PST by the 6 AM Pacific gate. |
| 0 14 * * * | 7:00 AM daily | 6:00 AM daily | Skipped during PDT; active in PST. |

The route processes request reminders, approved new public BASIC releases, compliance expiration checks, public-source refresh/analysis, evidence reconciliation, MCS-150 checks, snapshots and monitoring alerts. It can update operational rows during normal operation. Do not manually invoke it against Nationwide merely to prove scheduling under this pass's new-rows-only constraint.

1. Verify an unauthenticated request returns 401 rather than a login redirect.
2. Confirm the cron path remains in proxy.ts's explicit public API allowlist.
3. Confirm CRON_SECRET is configured securely in the Production environment.
4. Redeploy if the secret changes.
5. Inspect the production deployment's runtime logs after the applicable 6:00 AM Pacific run.
6. Record its timestamp, route, request ID and HTTP outcome.
7. Inspect the per-client result/errors and source freshness.
8. Record either the actual success evidence or the exact failure.

The September 23 evening audit found no scheduled-run log. Next entries: September 24, 2026 at 6:00 AM PDT (13:00 UTC, active) and 7:00 AM PDT (14:00 UTC, expected skip). An unauthorized 401 does not prove the correct bearer works, and HTTP 200 alone does not prove error-free processing: the route can return an errors array. An empty local env pull is not proof a production secret is missing.

## Existing proof and parked operations

Report 887439ea-58b8-4a4e-89b1-7bb75547ada7 was reviewed/unsent, numerically matched and token-checked; agency step 9 staff proof and prior disposable-request cleanup passed. Existing Nationwide records remain protected. Pass 4 outbox and BASIC receipts are in its report. The remaining Pass 4 synthetic fixture must be reconciled with Brandon's reported cleanup before a new fixture is made or old state is deleted.

Daven owns terms and secure credential architecture; Brandon owns SMTP/recovery and the next real-filing menu capture. Never collect a PIN in ordinary email or notes; legacy hex encoding is not encryption. Do not make a fake filing to capture menus. Preserve the Lane A provider/manual-order hold and the separate historical-import decision. No external filing or agency contact is authorized by this runbook.

Final sign-off must identify approved billing/email mode, source freshness, unresolved risks and the responsible humans. The draft terms banner stays until Daven approves the text.
