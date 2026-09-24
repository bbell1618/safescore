# Stripe go-live procedure

Prepared September 23, 2026. Owner: Brandon. This is a future human procedure, not authorization for Codex to use live keys, charge anyone, or change billing/email modes. Pass 5 leaves Stripe in TEST and EMAIL_DRY_RUN exactly true.

## Environment inventory from the application

| Variable read | Consumer | Live-mode change |
|---|---|---|
| STRIPE_SECRET_KEY | lib/stripe/client.ts; operator billing checks | Replace TEST secret with the same account's LIVE secret using Vercel secure controls. Never paste it into chat/logs. |
| STRIPE_WEBHOOK_SECRET | app/api/billing/webhook/route.ts | Use the signing secret of the LIVE dashboard endpoint, not the test endpoint or CLI forwarder. |
| STRIPE_PRICE_ASSESSMENT | lib/billing/assessment.ts; checkout route | Active LIVE one-time USD 299.00 price; quantity 1. |
| STRIPE_PRICE_MONITOR | checkout route dynamic price lookup | Matching LIVE recurring Monitor price. |
| STRIPE_PRICE_REMEDIATE | checkout route dynamic price lookup | Matching LIVE recurring Remediate price. |
| STRIPE_PRICE_TOTAL_SAFETY | checkout route dynamic price lookup | Matching LIVE recurring Total Safety base price. |
| STRIPE_PRICE_DRIVER_ADDON | checkout route dynamic price lookup | Matching LIVE recurring per-driver price; same cadence/currency as Total Safety. |

These are all seven Stripe-prefixed environment variables read under app/ and lib/, including dynamic process.env[name] lookups. This app uses hosted Checkout and does not read STRIPE_PUBLISHABLE_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. Do not add unused keys. NEXT_PUBLIC_APP_URL is also used for Checkout success/cancel and portal return URLs; it must match the approved HTTPS production hostname.

## Preconditions and dashboard steps

1. Obtain the launch decision covering billing, terms, approved tier prices and hostname in GoldenDesk.
2. Open the intended Stripe account in the Dashboard.
3. Confirm the account's business activation requirements are complete.
4. Switch the Dashboard to its live environment.
5. Create or select the live one-time Assessment price at exactly USD 299.00.
6. Create or select each approved live recurring tier price.
7. Create or select the live Total Safety driver add-on price.
8. Record a non-secret mapping from each price variable above to its live price ID.
9. Verify each price's active state, currency, amount, product and recurrence in the Dashboard.
10. Open Workbench → Webhooks (event destinations).
11. Add the HTTPS endpoint at the approved production hostname plus /api/billing/webhook.
12. Select checkout.session.completed, checkout.session.async_payment_succeeded, customer.subscription.deleted and invoice.payment_failed.
13. Set the destination API version to the application's pinned 2026-02-25.clover version.
14. Store the endpoint signing secret in the approved secret manager.
15. Configure the live Customer Portal in Stripe's Billing settings.
16. Record the configured return hostname and approved cancellation/payment-method settings.

If the Dashboard labels differ, use its Webhooks/event-destinations section; do not create a Connect destination or change API versions globally to compensate.

## Vercel steps — coordinated human cutover

1. Open Vercel → safescore → Settings → Environment Variables → Production.
2. Replace STRIPE_SECRET_KEY with the intended live account's key.
3. Replace STRIPE_WEBHOOK_SECRET with that live destination's signing secret.
4. Replace STRIPE_PRICE_ASSESSMENT with its live price ID.
5. Replace STRIPE_PRICE_MONITOR with its live price ID.
6. Replace STRIPE_PRICE_REMEDIATE with its live price ID.
7. Replace STRIPE_PRICE_TOTAL_SAFETY with its live price ID.
8. Replace STRIPE_PRICE_DRIVER_ADDON with its live price ID.
9. Check NEXT_PUBLIC_APP_URL against the approved production hostname.
10. Keep EMAIL_DRY_RUN exactly true during the billing proof.
11. Redeploy production after all matching settings are saved.
12. Record the deployment ID only after it reaches READY.
13. Retire the old test webhook destination from production delivery after confirming the live destination; retain test delivery only on the designated test environment.
14. Check for test-mode Stripe customers, subscriptions or paid Assessment receipts attached to real client rows before enabling purchases.
15. Resolve any mixed-mode records through a separately approved correction plan; never silently treat a TEST receipt as a live payment.

No partial cutover: test prices/customers cannot be used with live keys. Do not expose secret values in screenshots, terminal history or Work Logs.

## Exact no-charge $299 live Checkout proof

This verifies session creation, price, mode, hosted rendering and cancellation only. Payment completion, settlement, receipts, fulfillment and a live payment webhook cannot be proved without a separately authorized payment.

1. Use a clearly identified disposable Assessment account with Brandon's approved internal address, no existing Stripe customer/subscription/payment receipt, and no GEIA waiver.
2. Have Brandon personally complete its account/profile steps using approved test details and the approved terms.
3. Open its normal Assessment checkout button.
4. Confirm the hosted Stripe page shows the intended business and exactly USD 299.00 once.
5. Do not enter a card or click Stripe's payment/confirmation button.
6. Open the corresponding POST /v1/checkout/sessions entry in Stripe Workbench request logs.
7. Verify the returned session has livemode=true, mode=payment, currency=usd, amount_total=29900, payment_status=unpaid and status=open.
8. Verify the single line item uses the intended live Assessment price with quantity=1 and unit_amount=29900.
9. Verify metadata.tier=assessment and metadata.client_id belongs only to the disposable account.
10. Verify success_url and cancel_url use the approved production hostname.
11. Save a redacted receipt containing session ID, amount/currency/mode/status, price ID and deployment ID; omit the private Checkout URL and keys.
12. Expire that exact still-open session using Stripe's supported expire action/API in an authorized human session.
13. Verify status=expired and payment_status=unpaid.
14. Verify no successful charge or paid Assessment receipt exists for that disposable account.
15. Clean up only the disposable application fixture through the reviewed scoped cleanup procedure.

If a session becomes complete or paid unexpectedly, stop and report the real state; do not claim the no-charge proof or initiate a refund autonomously. Do not use Stripe test-card numbers in live mode.

## Webhook verification

The route reads raw request.text(), requires stripe-signature, and calls stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET) before any database/fulfillment operation. It returns 503 for an absent signing secret and 400 for absent/invalid signatures. Its middleware path is explicitly public so Stripe reaches the signature gate.

There is no test-key/live-key branch or hard-coded key/price in the webhook. The configured API key controls Stripe API calls; the configured endpoint secret controls signature verification. Assessment fulfillment additionally requires complete/paid, exactly USD 299.00 and matching account metadata, and stores session.livemode. Offline signature tests cover both event.livemode values, wrong/missing signatures and modified payloads. A live accepted payment event remains a human-owned proof after cutover; no live key or payment was used during Pass 5.

Sources:
- [Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)
- [Signature verification](https://docs.stripe.com/webhooks/signature)
- [Expire an open Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire)
