# SafeScore human launch runbook

Prepared September 23, 2026. GoldenDesk project `e642d966-a374-4317-8b10-6c9a003ffb67` is the official record. Follow these gates in order; the first gate unblocks the most work. An unchecked gate is **NOT VERIFIED**, even if an old task or local environment pull said otherwise.

Production: https://safescore.vercel.app. Vercel project: `safescore` / `prj_Pz8HKt8vV7P8EQPEA4bjDLizZ0Xb`. Supabase: `kzndtvkblfbrsnrnjodf`.

This is a human procedure, not authorization for an agent to send messages, use live Stripe keys, file cases, accept agreements, or change protected client data. Keep `EMAIL_DRY_RUN` exactly `true` and Stripe TEST throughout beta. Never print secrets or put them in GoldenDesk notes. Nationwide writes remain prohibited except this goal's own report drafts. Use only the explicitly named synthetic client for other write-based proofs. Never reset production or modify `bak_` tables.

## Live-proven starting points

| Gate | Evidence on September 23 | Status |
| --- | --- | --- |
| Public terms draft | /terms HTTP 200, 11 sections and pending-approval banner; scratch/goal-03-terms-live.png | DONE as draft; approval open |
| Public-table RLS | pg_class query returned [] for public tables without RLS | DONE for this audit |
| Invitation policy | pg_policies: only Service role only on client_invites, role service_role, command ALL | DONE for policy scope |
| Playbook review schema | Live review_status default 'draft'::text, metadata and CHECK constraint, staff SELECT-only policy | DONE for schema |
| Existing Nationwide playbooks | Original-column hashes unchanged; legacy review state NULL | DONE for preservation |
| Runtime email safety | Staff /console/email-safety showed exactly true after Brandon's redeploy dpl_5rG6kj818khzDFoExrJ9twxbwKmL | DONE September 23, 14:35 PT |
| SMTP, cron secret, Stripe mode, OpenRouter funding, provider credentials, app URL, custom DNS | No fresh runtime proof in this loop | NOT VERIFIED |

Invitation anon still has a table SELECT grant, but no applicable RLS policy; this is not a revoked grant. Security advisors were unchanged: 23 informational no-policy objects, two existing security-definer helper warnings, and disabled leaked-password protection. This loop did not change them. Detailed receipts are in scratch/goal-runbook-db-audit.json and scratch/goal-09a-advisors.json.

## 1. Staff sign-in and email safety — Brandon

1. Open https://safescore.vercel.app/login in the Codex in-app browser.
2. Sign in personally with the staff account.
3. Tell Codex “signed in” in the active goal task.
4. Open /console/email-safety in that signed-in browser.
5. If emailDryRunExactlyTrue is false, set production EMAIL_DRY_RUN to the literal true in Vercel → safescore → Settings → Environment Variables.
6. Redeploy safescore after any environment change.
7. Reload the staff endpoint after the deployment is READY.

**Claude verifies:** exact boolean true from the running deployment, matching SHA/deployment ID, no secret in output. Do not build or exercise purchase/onboarding/invitation flows while the boolean is false or unread. Do not infer it from a pulled .env file.

## 2. Complete the blocked safe proofs — Brandon with Codex

1. Keep the staff browser signed in for Plan, Work, Records, playbook and agency-request UI checks.
2. Review the new Nationwide monthly draft created specifically for this loop on Reports after Claude checks its facts.
3. Move only that draft to reviewed.
4. Select ZZ TEST — Goal Loop Carrier for the remaining lifecycle proof after gate 1 passes.
5. Sign in personally as that synthetic client when the portal checkpoint is reached.
6. Review the synthetic Total Safety gaps in Work and the client portal.
7. Review the scoped synthetic cleanup preview before its already-authorized execution.

**Claude verifies:** report text has no tokens; burden, monthly comparison anchor, cases, date and preparer match SQL; no report is sent; only own clearly identified draft outputs are removed; existing reports remain. Prove create → public ingest → analysis → burden → remediation → playbook draft/review/publish → dry-run invite → portal/checklist. Seed only three synthetic drivers/two vehicles; prove expired medical card, CDL due in 20 days, missing qualification document and due Clearinghouse query. Show cleanup counts and zero synthetic rows. No synthetic client or new report was created before this runbook.

The Nationwide walkthrough is read-only: inspect the existing agency-request card, filter/expand a violation, and inspect Plan/Work states. Do not click analysis, filing, request, playbook-generation or account-save controls for Nationwide.

## 3. Terms and filing authorization — Daven

1. Read /terms and content/legal/terms-draft.md.
2. Read the onboarding filing-authorization wording.
3. Record whether counsel review is needed in GoldenDesk task 674966a4-666a-4fc2-b088-baa207ee4674.
4. Record approval or specific edits in that task.

**Claude verifies:** Daven approval covers tiers, client truthfulness, filing authority, outcome limits, third-party fees, billing/cancellation and data handling. Only then remove “Draft — pending GEIA approval” in a tested deployment. A published draft is not legal advice or an approved agreement; do not accept it for a real client during this loop.

## 4. Recovery template and email readiness — Brandon

1. Open Supabase → kzndtvkblfbrsnrnjodf → Authentication → Email templates.
2. Copy the current recovery-template HTML into task 478f2406-7946-4093-aa43-51c343ce9f39 without a generated recovery link.
3. Review the offline samples in scratch/email-samples/.
4. Record wording approval in that task.
5. Resolve recovery-link logging task f01763e3-b545-46f6-992a-609ac80b2aea before generating a staff recovery link.
6. Confirm the approved work sender mailbox with Daven.
7. Create its Google app password personally if required.
8. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD or GMAIL_APP_PASSWORD through Vercel's production environment controls.
9. Review SMTP_SECURE, SMTP_FROM and EMAIL_REPLY_TO there.

**Claude verifies:** provider template matches approved wording, reset links are not logged, application samples cover every template, and the sender uses the approved work mailbox. Never use the personal bbell1618@ Google account. Recovery HTML in this repo is proposed, not a hosted-template capture. Twelve application samples were rendered with transport unavailable; nothing was sent.

Later human-only email activation, outside this goal:
1. Record the approved internal recipient in GoldenDesk.
2. Have the authorized human perform delivery/reply testing.
3. Record that test result in GoldenDesk.
4. Have the authorized human change delivery settings only after approval.

**Claude verifies:** the recorded human test and launch decision. Codex remains draft-only and never sends or triggers prebuilt sending pipelines. This goal never changes EMAIL_DRY_RUN to false.

## 5. Test billing and Assessment purchase — Brandon

1. Confirm the intended Stripe account is in TEST mode in Stripe.
2. Provide its TEST credentials through the approved secret store.
3. After gate 1 passes, review the $299 one-time Assessment implementation when Codex prepares it.
4. Confirm the TEST price assigned to STRIPE_PRICE_ASSESSMENT in Vercel.
5. Open the generated TEST checkout URL without paying.
6. Review the GEIA-insured waiver on the synthetic client's Account page.

**Claude verifies:** Assessment uses mode: payment, missing price returns clear 503 with no button, waiver records actor/time, recurring tiers remain correct, and checkout is TEST. A $299 USD TEST price and unpaid Checkout session were created September 23; the safe receipt is scratch/goal-assessment-stripe-proof.json. The private checkout link stays in scratch/goal-assessment-stripe-private.json and must not be pasted in logs. No payment was made.

The Account page's GEIA-insured switch waives only the one-time Assessment fee. It stores the staff actor and date. A verified paid Assessment or a recorded waiver allows profile submission for staff activation; it does not auto-activate a client or waive recurring charges. Payment fulfillment is covered by automated guards, but a completed paid transaction remains NOT VERIFIED in this unpaid-only proof.

Future live conversion is human-only and outside this goal:
1. Have the authorized human create live recurring prices, the Total Safety driver add-on and an active one-time $299 USD Assessment price in Stripe.
2. Have that human configure matching live secret/price IDs, including STRIPE_PRICE_ASSESSMENT, in Vercel and redeploy. Confirm no TEST receipts remain on real client accounts before launch.
3. Have that human configure the deployed /api/billing/webhook endpoint and signing secret.
4. Have that human perform the separately approved live payment.
5. Record the payment, customer-portal, cancellation and receipt results in GoldenDesk.

**Claude verifies:** the recorded human evidence. Never mix TEST prices with live keys. Codex must not use live keys or perform payment.

## 6. Monitoring and current federal data — Brandon

1. Record whether a controlled monitoring run may write to Nationwide in the GoldenDesk project.
2. Confirm a production CRON_SECRET exists through Vercel environment controls without exposing it.
3. Set a strong secret there only if absent or requiring replacement.
4. Redeploy after any change.
5. Authorize a scoped monitoring proof after gate 1 passes.
6. Open /api/operator/basic-source/2533650 while signed in as staff.
7. Decide monthly persistence scope in task ecbfb0fe-ecf5-492a-a346-c014bb280c75.
8. Confirm production FMCSA_API_KEY with its credential owner.
9. Resolve whether FMCSA_DATAHUB_APP_TOKEN is needed for the selected launch integrations.
10. Decide whether scripts using legacy SUPABASE_URL/SUPABASE_KEY aliases should be supplied or retired.

**Claude verifies:** safe cron result, scheduled execution, snapshot age/no-change behavior, dry-run reminder receipts, public source identity/date/currentness, no invented private values, only approved persistence. The September 23 public fetch returned the August 28 release. Read-only retrieval exists; scheduled persistence does not. Blank local secret pulls do not establish missing production settings.

For restricted measures, the designated human:
1. Signs in to FMCSA Portal.
2. Downloads the SMS All BASICs CSV.
3. Downloads the COMPASS inspection-detail XML.
4. Uploads each unedited file through the client FMCSA export uploader only within approved write scope.
5. Retains the original exports under agency policy.

**Claude verifies:** dates, parsed/inserted counts, unmatched codes and repeat-upload dedupe. Do not email exports to clients.

## 7. Historical import decision — Brandon

1. Review the reported date-join issue for Nationwide reports NCNK009958/NEUU000588 and 6286Q0KL6C/NBAA009479 in GoldenDesk.
2. Approve a specific additive correction scope or record deferral there.

**Claude verifies:** current rows still exhibit the issue before proposing an exact repair; unique-ID matching stays intact; no silent historical deletion. This goal did not repair protected Nationwide records.

## 8. Police reports and secure PIN handoff — Brandon

1. Confirm LexisNexis account activation and contracted response/delivery format with the provider administrator.
2. Store approved LEXISNEXIS_API_KEY and LEXISNEXIS_PAR_ENDPOINT in Vercel for the pull integration if used.
3. Store LEXISNEXIS_WEBHOOK_SECRET for the push integration if used.
4. Confirm any LEXISNEXIS_DOCUMENT_HOSTS against approved provider download hosts.
5. Authorize one scoped synthetic police-report delivery proof.
6. Record the approved credential vault/encryption design and key owner for U12 in task 03a82cde-ddac-4c86-bcce-8eb4e38d8692.

**Claude verifies:** provider reference, actual PDF, matching crash/case evidence, evidence-based assessment and human review, no external filing. Missing report does not mean ordered. The recorded hold on real manual PAR orders remains until Brandon changes it; this procedure does not authorize agency contact. Secure post-onboarding PIN handoff remains blocked on U12. Legacy encoding is not encryption; never place a PIN in notes.

## 9. Domain and callback ownership — Brandon/domain administrator

1. Confirm the intended launch hostname in GoldenDesk.
2. Add safescore.goldenerainsurance.com in Vercel → safescore → Settings → Domains if approved.
3. Create the exact DNS record Vercel provides in the domain administrator's controls.
4. Wait for the HTTPS certificate.
5. Set NEXT_PUBLIC_APP_URL to the verified hostname in production.
6. Review the Supabase authentication redirect allowlist for that hostname.
7. Redeploy after the URL change.
8. Sign in personally through the final hostname.

**Claude verifies:** HTTPS, login/callback, approved redirect origins, invite/reset destinations, report links, TEST Stripe success/cancel URLs. Do not infer the app URL from its code fallback. Repeat affected gates after changing the hostname.

## 10. Access, AI and recovery ownership — Brandon

1. Confirm approved Supabase and Vercel access owners in GoldenDesk.
2. Confirm production NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY through secure controls.
3. Review the two security-definer helper warnings in Supabase Security Advisor.
4. Decide whether to enable leaked-password protection in Supabase Authentication settings.
5. Confirm OpenRouter funding and access restrictions with its owner.
6. Record the backup/restore owner in GoldenDesk.
7. Record the incident contact in GoldenDesk.
8. Record the rollback owner in GoldenDesk.

**Claude verifies:** RLS/policies and intended helper permissions after authorized changes, no browser-exposed service key, fresh successful report, named recovery owners. Check %PDF, fonts/encoding, real burden/cases/date/preparer and no unsupported narrative claims. [VERIFY: ...] and INSUFFICIENT EVIDENCE must prevent filing approval. Local generated-font build issue bed6525a-dfe8-4645-8bfa-aaaa6c757202 remains open; passing retries do not prove root cause.

## 11. Filing workflow and final sign-off — Daven and Brandon

1. During the next independently authorized real CPDP filing, capture exact DataQs scenario strings in task 8ec8f6b2-e50e-412a-bc16-9ecfd47105d1.
2. Have Daven approve the final filing workflow and client-facing positioning in GoldenDesk.
3. Have Brandon record the beta walkthrough result in GoldenDesk.
4. Have Brandon record intended billing mode in GoldenDesk.
5. Have Brandon record intended email mode in GoldenDesk.
6. Have Daven record outside-client launch approval after required gates pass.

**Claude verifies:** sourced scenario mappings, reviewed evidence/authority for every filing, actual walkthrough/financial/delivery evidence, unresolved gates visible. Never fabricate DataQs wording or submit a filing to collect it. Filings outside SafeScore are not monitored; each SafeScore-client filing must first have its SafeScore case. READY alone is never launch sign-off.
