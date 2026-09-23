# SafeScore launch checklist

Use [the ordered human launch runbook](docs/launch-runbook.md). It replaces the old human checklist and separates live evidence from configuration assumptions.

SafeScore is **not yet verified for outside-client launch**. As of September 23, 2026, the runtime email-safety check, new report proof, synthetic-client lifecycle, Total Safety proof, hosted recovery template and human decisions remain open. A READY deployment does not close those gates.

- [x] Live database audit: zero public tables without RLS; client invitation policy targets only service_role (September 23).
- [x] Live playbook configuration: new rows default to draft; review metadata/constraints exist; original Nationwide playbook content unchanged (September 23).
- [x] Public /terms draft renders with pending-approval banner (September 23).
- [ ] Brandon signs in as staff for exact production EMAIL_DRY_RUN=true and accumulated verification.
- [ ] Daven approves content/legal/terms-draft.md and onboarding filing authorization before the banner is removed.
- [ ] Complete remaining runbook gates and record human launch sign-off in GoldenDesk.

No current secret value is asserted here. A redacted or blank environment pull is not evidence about the runtime. Keep email dry-run, Stripe TEST, additive migrations and the Nationwide write restriction. Never modify bak_ tables. Real filings remain human-only; filings outside SafeScore are not monitored.
