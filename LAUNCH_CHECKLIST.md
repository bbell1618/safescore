# SafeScore launch checklist

Every item below requires a human credential, external-service action, production decision, or real-world filing. Code-verifiable work is complete unless noted.

## Required before beta walkthrough

- [ ] Create or select a beta client account with a client-portal login for Daven’s walkthrough. The Phase 11 synthetic client was intentionally deleted after verification.
- [ ] Perform Brandon’s interactive beta walkthrough of the deployed authenticated analysis/import path and confirm the selected real carrier may be shown.
- [ ] Confirm production `NEXT_PUBLIC_APP_URL` points to the intended public hostname before invitations or Stripe redirects are used.
- [ ] Keep `EMAIL_DRY_RUN=true` for the walkthrough. Verify the dry-run log contains recipient, subject, template, and trigger only.
- [ ] Do not submit a real DataQ or CPDP during the walkthrough. Real filings and determination updates require Daven/Brandon’s human workflow and actual evidence.

## Email activation

- [ ] Create the Google app password for the approved work mailbox; never use the personal `bbell1618@` account.
- [ ] Add production SMTP values: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and either `GMAIL_APP_PASSWORD` or `SMTP_PASSWORD`.
- [ ] Review optional sender values: `SMTP_SECURE`, `SMTP_FROM`, and `EMAIL_REPLY_TO`.
- [ ] Send test messages only to an approved internal test recipient, verify delivery/reply behavior, and obtain launch approval.
- [ ] Only after approval, change `EMAIL_DRY_RUN` from `true` to `false`. The code defaults to dry-run unless the value is exactly `false`.

## Stripe live-mode switch

- [ ] Keep the current Stripe project in TEST mode through beta verification.
- [ ] In Stripe live mode, create the three recurring prices and Total Safety driver add-on.
- [ ] Replace production values with live-mode values for `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONITOR`, `STRIPE_PRICE_REMEDIATE`, `STRIPE_PRICE_TOTAL_SAFETY`, and `STRIPE_PRICE_DRIVER_ADDON`.
- [ ] Create the live webhook endpoint for the deployed `/api/billing/webhook` route and set its live signing value in `STRIPE_WEBHOOK_SECRET`.
- [ ] Run one approved live checkout at the correct tier, confirm the subscription row, customer portal, cancellation behavior, and receipt. Do not mix test price IDs with a live secret key.

## LexisNexis PAR retrieval

- [ ] Activate the LexisNexis police-accident-report account and confirm the production endpoint/response contract.
- [ ] Set `LEXISNEXIS_API_KEY` and `LEXISNEXIS_PAR_ENDPOINT` in production.
- [ ] Retrieve one authorized test PAR, confirm its provider reference and PDF, then verify it lands in the matching CPDP evidence slot.
- [ ] Until this is complete, the UI must continue to show **PAR retrieval pending account activation** and operators must use manual upload. Never create fake PAR data.

## FMCSA access and export SOP

- [ ] Provision/confirm the production FMCSA web key in `FMCSA_API_KEY`.
- [ ] Resolve the Phase 0 environment-name gap for `FMCSA_DATAHUB_APP_TOKEN`; add the correct production value only if the corresponding DataHub integration is intended for launch.
- [ ] Resolve the Phase 0 legacy aliases `SUPABASE_URL` and `SUPABASE_KEY`. Current application paths use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; either supply the aliases for the scripts that reference them or remove those references after human review.
- [ ] For each authenticated refresh, sign in to the FMCSA Portal and download both exports without editing them:
  1. SMS **All BASICs** CSV.
  2. COMPASS **inspection detail** XML.
- [ ] In the SafeScore operator client file, upload each file through the FMCSA export uploader.
- [ ] Confirm the uploader reports the correct kind, parsed/inserted counts, snapshot date, and unmatched codes. A repeat upload must report skipped/deduplicated rather than duplicate rows.
- [ ] Retain the original downloaded files according to GEIA’s evidence-retention policy; do not email them to a client unless separately authorized.

## Domain and DNS

- [ ] Add `safescore.goldenerainsurance.com` to the SafeScore Vercel project.
- [ ] Create the exact DNS record Vercel supplies (CNAME/A as shown by Vercel) with the domain administrator.
- [ ] Wait for Vercel certificate issuance, then verify HTTPS and the full login/callback flow on the custom domain.
- [ ] Update `NEXT_PUBLIC_APP_URL` to `https://safescore.goldenerainsurance.com` only after the domain is verified, then re-test portal invitations, Stripe success/cancel URLs, report links, and auth callbacks.

## Supabase and production access review

- [ ] Confirm production has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; never expose the service-role value to browser code.
- [ ] Re-run the RLS audit and confirm zero public tables without RLS.
- [ ] Re-run `pg_policies` for `client_invites` and confirm anon has no policy access and the replacement policy is scoped to `service_role` only.
- [ ] Keep all production migrations additive-only. Never reset, truncate, or modify protected `bak_` backup tables.

## AI and report generation

- [ ] Confirm `OPENROUTER_API_KEY` is funded and restricted appropriately.
- [ ] Generate and visually review one report after the final domain/env change. Confirm `%PDF`, embedded fonts, no encoding artifacts, canonical burden totals, and actual case counts.
- [ ] Review every AI-generated DataQ/CPDP narrative against its evidence. `[VERIFY: ...]` or `INSUFFICIENT EVIDENCE` must block approval/filing.

## Final human launch sign-off

- [ ] Brandon confirms all beta routes and the Request Queue in the production UI.
- [ ] Daven approves licensed/final filing workflow and client-facing positioning.
- [ ] Brandon confirms Stripe is intentionally in TEST or LIVE mode and records the decision.
- [ ] Brandon confirms email is intentionally dry-run or live and records the decision.
- [ ] Brandon confirms DNS, backups, access ownership, incident contact, and rollback owner.
